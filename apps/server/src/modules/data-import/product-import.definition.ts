import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { ProductsService } from '@/modules/catalog/products.service';
import {
  CreateProductSchema,
  CreateProductDto,
} from '@/modules/catalog/dto/create-product.dto';
import {
  PRODUCT_IMPORT_COLUMNS,
  ProductImportRow,
  ProductImportRowSchema,
  ImportIssue,
} from '@pharmacy/shared-validation';
import { SystemModule } from '@pharmacy/shared-types';
import { ImportRowRejectedException } from './exceptions/import-row-rejected.exception';
import {
  ImportDefinition,
  ImportExecutionContext,
  ImportRowWithNumber,
  buildAliasMap,
  normalizeCellValue,
  normalizeHeader,
  zodIssuesToImportIssues,
} from './import-definition';

/**
 * Product import definition. Rows are written through ProductsService so the
 * price/cost/tax history machinery stays owned by the catalog module.
 */

/** Per-row foreign references resolved in batch by prepare(). */
export interface ProductImportRefs {
  categoryId?: string;
  pharmaceuticalFormId?: string;
  taxSchemeId?: string;
}

@Injectable()
export class ProductImportDefinition implements ImportDefinition<
  ProductImportRow,
  { id: string },
  ProductImportRefs
> {
  readonly entityKey = 'products';
  readonly entityLabel = 'Products';
  readonly auditModule = SystemModule.CATALOG;
  readonly columns = PRODUCT_IMPORT_COLUMNS;
  private readonly aliasMap = buildAliasMap(PRODUCT_IMPORT_COLUMNS);

  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly productsService: ProductsService,
  ) {}

  mapColumns(record: Record<string, unknown>): {
    data: Record<string, unknown>;
    issues: ImportIssue[];
  } {
    const data: Record<string, unknown> = {};
    for (const [header, value] of Object.entries(record)) {
      const key = this.aliasMap.get(normalizeHeader(header));
      if (!key) continue;
      data[key] = normalizeCellValue(value);
    }
    return { data, issues: [] };
  }

  validate(
    data: Record<string, unknown>,
  ): { data: ProductImportRow } | { issues: ImportIssue[] } {
    const result = ProductImportRowSchema.safeParse(data);
    if (!result.success)
      return { issues: zodIssuesToImportIssues(result.error) };
    return { data: result.data };
  }

  /**
   * Resolves category/form/tax-scheme names for the whole row set in a
   * handful of batched queries (one per reference type, over unique names)
   * instead of three queries per row.
   */
  async prepare(
    ctx: ImportExecutionContext,
    rows: Array<ImportRowWithNumber<ProductImportRow>>,
  ): Promise<Map<number, ProductImportRefs>> {
    const subscriptionId = this.tenantContext.getSubscriptionId();
    const categoryNames = uniqueNames(rows.map((row) => row.data.categoryName));
    const formNames = uniqueNames(
      rows.map((row) => row.data.pharmaceuticalFormName),
    );
    const taxNames = uniqueNames(rows.map((row) => row.data.taxSchemeName));

    const [categories, forms, taxSchemes] = await Promise.all([
      categoryNames.length > 0
        ? this.prisma.category.findMany({
            where: {
              subscriptionId,
              name: { in: categoryNames, mode: 'insensitive' },
              isActive: true,
            },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      formNames.length > 0
        ? this.prisma.pharmaceuticalForm.findMany({
            where: {
              subscriptionId,
              name: { in: formNames, mode: 'insensitive' },
              isActive: true,
            },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      taxNames.length > 0
        ? this.prisma.taxScheme.findMany({
            where: {
              subscriptionId,
              name: { in: taxNames, mode: 'insensitive' },
              isActive: true,
            },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const categoryIdByName = new Map(
      categories.map((category) => [category.name.toLowerCase(), category.id]),
    );
    const formIdByName = new Map(
      forms.map((form) => [form.name.toLowerCase(), form.id]),
    );
    const taxSchemeIdByName = new Map(
      taxSchemes.map((scheme) => [scheme.name.toLowerCase(), scheme.id]),
    );

    return new Map(
      rows.map((row) => [
        row.rowNumber,
        {
          categoryId: row.data.categoryName
            ? categoryIdByName.get(row.data.categoryName.toLowerCase())
            : undefined,
          pharmaceuticalFormId: row.data.pharmaceuticalFormName
            ? formIdByName.get(row.data.pharmaceuticalFormName.toLowerCase())
            : undefined,
          taxSchemeId: taxSchemeIdByName.get(
            row.data.taxSchemeName.toLowerCase(),
          ),
        },
      ]),
    );
  }

  async createOne(
    ctx: ImportExecutionContext,
    input: ProductImportRow,
    refs?: ProductImportRefs,
  ): Promise<{ id: string }> {
    // Refs come pre-resolved from prepare() (batched). The fallback resolves
    // lazily so direct callers (tests, other modules) keep working.
    const resolved = refs ?? (await this.resolveReferencesLazily(input));

    if (input.categoryName && !resolved.categoryId) {
      throw new ImportRowRejectedException(
        `La categoria "${input.categoryName}" no existe en el sistema`,
      );
    }
    if (input.pharmaceuticalFormName && !resolved.pharmaceuticalFormId) {
      throw new ImportRowRejectedException(
        `La forma farmaceutica "${input.pharmaceuticalFormName}" no existe en el sistema`,
      );
    }
    if (!resolved.taxSchemeId) {
      throw new ImportRowRejectedException(
        `No se encontro el esquema de impuesto "${input.taxSchemeName}" en el sistema`,
      );
    }

    const dto: CreateProductDto = CreateProductSchema.parse({
      internalCode: input.internalCode,
      commercialName: input.commercialName,
      concentration: input.concentration,
      concentrationUnit: input.concentrationUnit,
      laboratory: input.laboratory,
      saleType: input.saleType,
      minimumStock: input.minimumStock,
      invimaRegistry: input.invimaRegistry,
      atcCode: input.atcCode,
      categoryId: resolved.categoryId,
      pharmaceuticalFormId: resolved.pharmaceuticalFormId,
      initialPrice: input.initialPrice,
      initialCost: input.initialCost,
      initialTaxSchemeId: resolved.taxSchemeId,
    });

    const created = await this.productsService.createProduct(ctx.userId, dto);
    return { id: created.id };
  }

  async findConflicts(
    _ctx: { subscriptionId: string },
    rows: Array<ImportRowWithNumber<ProductImportRow>>,
  ): Promise<Map<number, ImportIssue[]>> {
    // internalCode is globally unique in the schema, so the check is
    // tenant-independent and intentionally matches duplicates across
    // subscriptions (they would fail on the unique index anyway).
    const rowByCode = new Map<string, number>();
    for (const row of rows) {
      rowByCode.set(row.data.internalCode, row.rowNumber);
    }

    const existing = await this.prisma.product.findMany({
      where: { internalCode: { in: [...rowByCode.keys()] } },
      select: { internalCode: true },
    });

    const conflicts = new Map<number, ImportIssue[]>();
    for (const product of existing) {
      const rowNumber = rowByCode.get(product.internalCode);
      if (rowNumber !== undefined) {
        conflicts.set(rowNumber, [
          {
            path: 'internalCode',
            message: `El codigo interno "${product.internalCode}" ya existe en el sistema`,
          },
        ]);
      }
    }
    return conflicts;
  }

  /**
   * Lazy per-row fallback used when createOne is called without pre-resolved
   * refs (direct callers). Returns ids WITHOUT throwing; createOne validates
   * the result and raises the row-level rejection with the missing name.
   */
  private async resolveReferencesLazily(
    input: ProductImportRow,
  ): Promise<ProductImportRefs> {
    const subscriptionId = this.tenantContext.getSubscriptionId();
    const [category, form, taxScheme] = await Promise.all([
      input.categoryName
        ? this.prisma.category.findFirst({
            where: {
              subscriptionId,
              name: { equals: input.categoryName, mode: 'insensitive' },
              isActive: true,
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      input.pharmaceuticalFormName
        ? this.prisma.pharmaceuticalForm.findFirst({
            where: {
              subscriptionId,
              name: {
                equals: input.pharmaceuticalFormName,
                mode: 'insensitive',
              },
              isActive: true,
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      this.prisma.taxScheme.findFirst({
        where: {
          subscriptionId,
          name: { equals: input.taxSchemeName, mode: 'insensitive' },
          isActive: true,
        },
        select: { id: true },
      }),
    ]);

    return {
      categoryId: category?.id,
      pharmaceuticalFormId: form?.id,
      taxSchemeId: taxScheme?.id,
    };
  }
}

/** Unique non-empty values, preserving input casing for lookup messages. */
function uniqueNames(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value) => value !== undefined))];
}
