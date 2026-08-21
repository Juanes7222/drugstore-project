/**
 * Product import definition — reuses the shared PRODUCT_IMPORT_COLUMNS and
 * ProductImportRowSchema from @pharmacy/shared-validation and writes rows
 * through the local ProductService so the price/cost/tax history machinery
 * and the PRODUCT_CREATION sync entry stay owned by the catalog module.
 */

import type { PrismaClient } from "@pharmacy/database/local";
import { SaleType } from "@pharmacy/database/local";
import {
  PRODUCT_IMPORT_COLUMNS,
  ProductImportRowSchema,
  type ImportIssue,
  type ProductImportRow,
} from "@pharmacy/shared-validation";
import type { ProductService } from "../../catalog/product.service";
import { UnsyncedReferenceException } from "../../catalog/exceptions";
import {
  buildAliasMap,
  normalizeCellValue,
  normalizeHeader,
  zodIssuesToImportIssues,
} from "../import-common";
import type { ImportRowWithNumber } from "./import-definition";
import type { ImportDefinition } from "./import-definition";
import { ImportRowRejectedException } from "../exceptions";
import type { CreateProductInput } from "../../catalog/product.service";

/**
 * Product import definition. Rows are written through ProductService so the
 * price/cost/tax history machinery stays owned by the catalog module.
 */
export class ProductImportDefinition implements ImportDefinition<
  ProductImportRow,
  { id: string }
> {
  readonly entityKey = "products" as const;
  readonly entityLabel = "Products";
  readonly columns = PRODUCT_IMPORT_COLUMNS;
  private readonly aliasMap = buildAliasMap(PRODUCT_IMPORT_COLUMNS);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly productService: ProductService,
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

  async createOne(input: ProductImportRow): Promise<{ id: string }> {
    const categoryId = input.categoryName
      ? await this.resolveCategoryId(input.categoryName)
      : undefined;
    const pharmaceuticalFormId = input.pharmaceuticalFormName
      ? await this.resolvePharmaceuticalFormId(input.pharmaceuticalFormName)
      : undefined;
    const taxSchemeId = await this.resolveTaxSchemeId(input.taxSchemeName);

    const createInput: CreateProductInput = {
      commercialName: input.commercialName,
      concentration: input.concentration ?? null,
      concentrationUnit: input.concentrationUnit ?? null,
      laboratory: input.laboratory,
      saleType: input.saleType as SaleType,
      minimumStock: input.minimumStock,
      invimaRegistry: input.invimaRegistry ?? null,
      atcCode: input.atcCode ?? null,
      categoryId,
      pharmaceuticalFormId,
      price: {
        price: input.initialPrice,
        changeReason: "Initial price from import",
      },
      tax: {
        taxSchemeId,
        changeReason: "Initial tax from import",
      },
      initialCost:
        input.initialCost !== undefined
          ? {
              cost: input.initialCost,
              changeReason: "Initial cost from import",
            }
          : undefined,
      barcodes: [],
    };

    try {
      const created = await this.productService.createProduct(createInput);
      return { id: (created as { id: string }).id };
    } catch (error) {
      if (
        error instanceof UnsyncedReferenceException &&
        error.reason === "local_seed_id"
      ) {
        // The row referenced a locally seeded tax scheme (seed-* id) that
        // the server has never seen. This is a sync-ordering problem, not
        // a file problem: the row is valid but cannot be pushed yet.
        throw new ImportRowRejectedException(
          `El esquema de impuesto "${input.taxSchemeName}" no esta sincronizado con el servidor. ` +
            "Sincronice el catalogo y reintente la importacion.",
        );
      }
      throw error;
    }
  }

  async findConflicts(
    rows: Array<ImportRowWithNumber<ProductImportRow>>,
  ): Promise<Map<number, ImportIssue[]>> {
    const conflicts = new Map<number, ImportIssue[]>();
    const firstRowByCode = new Map<string, number>();

    // Duplicates inside the file itself: the first occurrence wins, later
    // rows are flagged so the operator can decide before executing.
    for (const row of rows) {
      const existingRow = firstRowByCode.get(row.data.internalCode);
      if (existingRow !== undefined) {
        conflicts.set(row.rowNumber, [
          {
            path: "internalCode",
            message: `El codigo interno "${row.data.internalCode}" se repite en el archivo (fila ${existingRow})`,
          },
        ]);
      } else {
        firstRowByCode.set(row.data.internalCode, row.rowNumber);
      }
    }

    // Conflicts against existing local rows. internalCode is unique in the
    // schema, so the check matches duplicates across any source.
    const existing = await this.prisma.product.findMany({
      where: { internalCode: { in: [...firstRowByCode.keys()] } },
      select: { internalCode: true },
    });
    for (const product of existing) {
      const rowNumber = firstRowByCode.get(product.internalCode);
      if (rowNumber !== undefined) {
        conflicts.set(rowNumber, [
          {
            path: "internalCode",
            message: `El codigo interno "${product.internalCode}" ya existe en el sistema`,
          },
        ]);
      }
    }

    return conflicts;
  }

  private async resolveCategoryId(name: string): Promise<string> {
    const category = await this.prisma.category.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        isActive: true,
      },
      select: { id: true },
    });
    if (!category) {
      throw new ImportRowRejectedException(
        `La categoria "${name}" no existe en el sistema`,
      );
    }
    return category.id;
  }

  private async resolvePharmaceuticalFormId(name: string): Promise<string> {
    const form = await this.prisma.pharmaceuticalForm.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        isActive: true,
      },
      select: { id: true },
    });
    if (!form) {
      throw new ImportRowRejectedException(
        `La forma farmaceutica "${name}" no existe en el sistema`,
      );
    }
    return form.id;
  }

  private async resolveTaxSchemeId(name: string): Promise<string> {
    const taxScheme = await this.prisma.taxScheme.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        isActive: true,
      },
      select: { id: true },
    });
    if (!taxScheme) {
      throw new ImportRowRejectedException(
        `No se encontro el esquema de impuesto "${name}" en el sistema`,
      );
    }
    return taxScheme.id;
  }
}
