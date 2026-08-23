/**
 * Local product service for the POS desktop app.
 *
 * Manages product CRUD operations with local-first persistence and async
 * server sync through the SyncQueue.
 *
 * ## Architecture notes
 *
 * ### Local vs server authority
 * Products created offline carry a provisional `internalCode` in the format
 * `OFFLINE-{uuid}`. After sync, the server assigns a real sequential code
 * and reflects it back via a sync response. The local record is updated
 * at that point. Products that exist only on the server are downloaded
 * through `CatalogSyncService` — this service is for POS-side creation and
 * update only.
 *
 * ### Two-step price/tax pointer pattern
 * The `Product.currentPriceId` and `Product.currentTaxHistoryId` pointers
 * cannot reference rows that don't exist yet. The creation flow is:
 * 1. Create Product with both pointers NULL
 * 2. Create ProductPriceHistory and ProductTaxHistory rows
 * 3. Update Product to set the pointers
 *
 * This matches the deferrable-constraint pattern described in the Prisma
 * schema comment.
 *
 * ### Sync integration
 * `createProduct` and `updateProduct` each create a SyncQueue row
 * (operationType: PRODUCT_CREATION or PRODUCT_UPDATE) inside the same
 * transaction. Soft-delete (`isActive = false`) does NOT create a sync
 * entry — deletion is replicated by the server as a side effect of
 * processing PRODUCT_CREATION/PRODUCT_UPDATE.
 *
 * ### Sync payload contract
 * The `createProductDto` built for the sync queue mirrors the server's
 * `CreateProductSchema` (apps/server/src/modules/catalog/dto/create-product.dto.ts).
 * Two non-obvious requirements the POS used to get wrong:
 * - `initialPrice` is a flat top-level string, not a nested `price` object.
 * - `initialTaxSchemeId` is a flat top-level string, not a nested `tax.taxSchemeId`.
 * - `pharmaceuticalFormId` / `categoryId` (optional) must be a non-empty
 *   string when present — empty strings are rejected by the server's
 *   Zod schema as `z.string().min(1)`.
 *
 * Reference ids must be a non-empty string that is not a `seed-*` local
 * only id, AND must exist in the local cache (taxScheme /
 * pharmaceuticalForm / category rows). The server accepts both
 * canonical UUIDs and the slug-style ids used by the seed
 * (`tax_exento`, `pf_tablet`, `cat_antibiotics`, etc. — see
 * packages/database/prisma/schema.prisma:10-14), so the only format
 * check the POS enforces is "not a `seed-` local-only id". The local
 * cache existence check is what actually protects against pushing an id
 * the server has never seen.
 */
import { PrismaClient, Prisma, SaleType, CommissionType } from '@pharmacy/database/local';
import type { AuthService } from '../auth/auth.service';
import { RoleType } from '@pharmacy/shared-types';
import { notifyPendingEntry } from '../sync/sync-queue-notifier';
import {
  ProductNotFoundException,
  ProductUpdateException,
  DuplicateBarcodeException,
  UnsyncedReferenceException,
  InvalidCommissionException,
} from './exceptions';

// ---------------------------------------------------------------------------
// Public input types
// ---------------------------------------------------------------------------

export interface ProductBarcodeInput {
  barcode: string;
  barcodeType: 'EAN13' | 'EAN14' | 'GTIN' | 'INTERNAL' | 'DATAMATRIX';
  isPrimary?: boolean;
}

export interface CreateProductPriceInput {
  price: number | string | Prisma.Decimal;
  effectiveFrom?: Date | string;
  changeReason?: string;
}

export interface CreateProductCostInput {
  cost: number | string | Prisma.Decimal;
  effectiveFrom?: Date | string;
  changeReason?: string;
}

export interface CreateProductTaxInput {
  taxSchemeId: string;
  effectiveFrom?: Date | string;
  changeReason?: string;
}

export interface CreateProductInput {
  commercialName: string;
  concentration?: string | null;
  concentrationUnit?: string | null;
  laboratory: string;
  saleType: SaleType;
  minimumStock?: number;
  invimaRegistry?: string | null;
  atcCode?: string | null;
  therapeuticIndication?: string | null;
  storageConditions?: string | null;
  internalNotes?: string | null;
  categoryId?: string | null;
  pharmaceuticalFormId?: string | null;
  /** Sales commission: PERCENTAGE or FIXED. Defaults to NONE. */
  commissionType?: CommissionType;
  /** Percentage points (PERCENTAGE) or COP per unit (FIXED). */
  commissionValue?: number | string | Prisma.Decimal;
  /** Optional validity window start (inclusive). */
  commissionStartsAt?: Date | string | null;
  /** Optional validity window end (inclusive). */
  commissionEndsAt?: Date | string | null;
  /** Default price entry. Required for offline creation. */
  price: CreateProductPriceInput;
  /** Default tax entry. Required for offline creation. */
  tax: CreateProductTaxInput;
  /** Default barcodes (must include at least one primary). */
  barcodes: ProductBarcodeInput[];
  /** Optional initial cost entry. */
  initialCost?: CreateProductCostInput;
}

export interface UpdateProductInput {
  commercialName?: string;
  concentration?: string | null;
  concentrationUnit?: string | null;
  laboratory?: string;
  saleType?: SaleType;
  minimumStock?: number;
  invimaRegistry?: string | null;
  atcCode?: string | null;
  therapeuticIndication?: string | null;
  storageConditions?: string | null;
  internalNotes?: string | null;
  categoryId?: string | null;
  pharmaceuticalFormId?: string | null;
  /** Sales commission: PERCENTAGE or FIXED. NONE disables it. */
  commissionType?: CommissionType;
  /** Percentage points (PERCENTAGE) or COP per unit (FIXED). */
  commissionValue?: number | string | Prisma.Decimal;
  /** Optional validity window start (inclusive). Pass null to clear. */
  commissionStartsAt?: Date | string | null;
  /** Optional validity window end (inclusive). Pass null to clear. */
  commissionEndsAt?: Date | string | null;
  /** If set, replaces the full barcode set (delete stale, upsert new). */
  barcodes?: ProductBarcodeInput[];
  /** New price entry (creates a new ProductPriceHistory, updates currentPriceId). */
  newPrice?: CreateProductPriceInput;
  /** New tax entry (creates a new ProductTaxHistory, updates currentTaxHistoryId). */
  newTax?: CreateProductTaxInput;
  /** New cost entry (creates a new ProductCostHistory, updates currentCostId). */
  newCost?: CreateProductCostInput;
}

export interface ProductListItem {
  id: string;
  internalCode: string;
  commercialName: string;
  concentration: string | null;
  concentrationUnit: string | null;
  laboratory: string;
  saleType: SaleType;
  minimumStock: number;
  isActive: boolean;
  invimaRegistry: string | null;
  atcCode: string | null;
  therapeuticIndication: string | null;
  storageConditions: string | null;
  internalNotes: string | null;
  categoryId: string | null;
  pharmaceuticalFormId: string | null;
  createdAt: string;
  updatedAt: string;
  barcodes: Array<{ id: string; barcode: string; barcodeType: string; isPrimary: boolean }>;
  /** Active price as decimal string, or null if no price set. */
  currentPrice: string | null;
  /** Active cost (CPP) as decimal string, or null if no cost set. */
  currentCost: string | null;
  /** Active tax scheme id, or null if no tax set. */
  currentTaxSchemeId: string | null;
  /** Active tax scheme name (e.g. "IVA 19%"), or null if no tax set. */
  currentTaxSchemeName: string | null;
  /** Active category name, or null. */
  categoryName: string | null;
  /** Active pharmaceutical form name, or null. */
  pharmaceuticalFormName: string | null;
  /** Commission configuration (NONE when the product has none). */
  commissionType: CommissionType;
  commissionValue: string;
  commissionStartsAt: string | null;
  commissionEndsAt: string | null;
}

export interface ProductSearchResult {
  id: string;
  internalCode: string;
  commercialName: string;
  concentration: string | null;
  laboratory: string;
  saleType: SaleType;
  isActive: boolean;
  currentPrice: string | null;
  currentCost: string | null;
  /** Commission configuration (NONE when the product has none). */
  commissionType: CommissionType;
  /** Percentage points (PERCENTAGE) or COP per unit (FIXED) as decimal string. */
  commissionValue: string;
  /** Optional validity window start (inclusive), ISO, or null. */
  commissionStartsAt: string | null;
  /** Optional validity window end (inclusive), ISO, or null. */
  commissionEndsAt: string | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createProductService = (
  prisma: PrismaClient,
  auth: AuthService,
): ProductService => {
  return new ProductService(prisma, auth);
};

// ---------------------------------------------------------------------------
// Sync payload helpers
// ---------------------------------------------------------------------------

/**
 * Prefix used by the offline catalog seed rows created in
 * `src/infrastructure/local-database.ts` (e.g. `seed-iva-19`,
 * `seed-iva-5`, `seed-exento`, `seed-inc`). The server has no
 * equivalent rows — its seed uses slug-style ids like `tax_exento` —
 * so any `seed-` id would be rejected by the sync push. Kept as a
 * single constant so the producer and any future Zod mirror stay
 * aligned without hardcoding the prefix in more than one place.
 */
const LOCAL_SEED_PREFIX = 'seed-';

/**
 * True when the trimmed value starts with the local seed prefix
 * (case-insensitive). These ids are POS-local-only and must never be
 * sent to the server.
 */
const isLocalSeedId = (value: string | null | undefined): boolean => {
  return (
    typeof value === 'string' &&
    value.trim().toLowerCase().startsWith(LOCAL_SEED_PREFIX)
  );
};

/**
 * Normalise an optional reference field for the sync payload.
 *
 * - `null` / `undefined` / whitespace-only string  → `undefined`
 *   (so the server's `.optional()` skips the field).
 * - `seed-` local-only id  → throws `UnsyncedReferenceException` with
 *   `reason: 'local_seed_id'` so the producer fails fast with a clear,
 *   typed error instead of letting the server reject it as "unknown id".
 * - Any other non-empty string  → returned trimmed. The server accepts
 *   both canonical UUIDs and slug-style ids (`tax_exento`, `pf_tablet`,
 *   `cat_antibiotics`, etc.), so no format check is applied here beyond
 *   the local-seed exclusion. The local cache existence check
 *   (`assertReferenceExists`) is what actually catches typos and
 *   unsynced ids.
 */
export const sanitizeOptionalReferenceId = (
  value: string | null | undefined,
  referenceType: 'pharmaceuticalForm' | 'category',
): string | undefined => {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (isLocalSeedId(trimmed)) {
    throw new UnsyncedReferenceException(
      referenceType,
      value,
      'local_seed_id',
    );
  }
  return trimmed;
};

/**
 * Validate a commission configuration before it is persisted.
 *
 * Rules:
 * - `commissionValue` must never be negative (0 disables the
 *   commission).
 * - When both window bounds are set, `commissionStartsAt` must be
 *   before or equal to `commissionEndsAt` — an inverted window would
 *   silently disable the commission forever.
 *
 * Throws `InvalidCommissionException` with a structured `reason` so
 * the UI can branch on it.
 */
const assertCommissionConfigValid = (
  input: Pick<
    CreateProductInput | UpdateProductInput,
    'commissionValue' | 'commissionStartsAt' | 'commissionEndsAt'
  >,
): void => {
  const value =
    input.commissionValue == null ? null : new Prisma.Decimal(input.commissionValue);
  if (value != null && value.isNegative()) {
    throw new InvalidCommissionException('negative_value');
  }
  if (input.commissionStartsAt != null && input.commissionEndsAt != null) {
    const startsAt = new Date(input.commissionStartsAt);
    const endsAt = new Date(input.commissionEndsAt);
    if (
      !Number.isNaN(startsAt.getTime()) &&
      !Number.isNaN(endsAt.getTime()) &&
      startsAt.getTime() > endsAt.getTime()
    ) {
      throw new InvalidCommissionException('inverted_window');
    }
  }
};

/**
 * Require a non-empty, non-seed reference id for a mandatory field.
 *
 * Used for `initialTaxSchemeId`, which the server validates as a
 * required `z.string().min(1)`. The only ids this helper rejects are
 * `seed-*` local-only rows (and empty / null values) — every other
 * non-empty string is accepted on the assumption that the follow-up
 * `assertReferenceExists` call will catch ids that the server has
 * never heard of. The server accepts both UUIDs and slug-style ids.
 */
export const requireServerReferenceId = (
  value: string | null | undefined,
  referenceType: 'taxScheme' | 'pharmaceuticalForm' | 'category',
): string => {
  if (typeof value !== 'string') {
    throw new UnsyncedReferenceException(
      referenceType,
      value ?? '',
      'local_seed_id',
    );
  }
  const trimmed = value.trim();
  if (trimmed === '' || isLocalSeedId(trimmed)) {
    throw new UnsyncedReferenceException(
      referenceType,
      value,
      'local_seed_id',
    );
  }
  return trimmed;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ProductService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
  ) {}

  /**
   * List products with optional search and pagination.
   *
   * Searches across `commercialName` and `internalCode`. Optionally filters
   * by `isActive`.
   *
   * Returns a flat list with primary barcode and active price.
   *
   * Requires CASHIER or ADMIN role.
   */
  async listProducts(params?: {
    query?: string;
    isActive?: boolean;
    includeInactive?: boolean;
    categoryId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: ProductListItem[]; total: number }> {
    this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    const {
      query,
      includeInactive,
      categoryId,
      limit = 50,
      offset = 0,
    } = params ?? {};

    const where: Prisma.ProductWhereInput = {};

    if (!includeInactive) {
      where.isActive = true;
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (query?.trim()) {
      const q = query.trim().toLowerCase();
      where.OR = [
        { commercialName: { contains: q, mode: 'insensitive' } },
        { internalCode: { contains: q, mode: 'insensitive' } },
        { barcodes: { some: { barcode: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: {
          barcodes: {
            select: { id: true, barcode: true, barcodeType: true, isPrimary: true },
          },
          category: { select: { name: true } },
          pharmaceuticalForm: { select: { name: true } },
          priceHistories: {
            where: { effectiveTo: null },
            select: { price: true },
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
          },
          costHistories: {
            where: { effectiveTo: null },
            select: { cost: true },
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
          },
          taxHistories: {
            where: { effectiveTo: null },
            select: { taxSchemeId: true, taxScheme: { select: { name: true } } },
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
          },
        },
        orderBy: { commercialName: 'asc' },
        take: limit,
        skip: offset,
      }),
    ]);

    return {
      total,
      items: products.map((p) => ({
        id: p.id,
        internalCode: p.internalCode,
        commercialName: p.commercialName,
        concentration: p.concentration,
        concentrationUnit: p.concentrationUnit,
        laboratory: p.laboratory,
        saleType: p.saleType as SaleType,
        minimumStock: p.minimumStock,
        isActive: p.isActive,
        invimaRegistry: p.invimaRegistry,
        atcCode: p.atcCode,
        therapeuticIndication: p.therapeuticIndication,
        storageConditions: p.storageConditions,
        internalNotes: p.internalNotes,
        categoryId: p.categoryId,
        pharmaceuticalFormId: p.pharmaceuticalFormId,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        barcodes: p.barcodes,
        currentPrice: p.priceHistories[0]?.price.toString() ?? null,
        currentCost: p.costHistories[0]?.cost.toString() ?? null,
        currentTaxSchemeId: p.taxHistories[0]?.taxSchemeId ?? null,
        currentTaxSchemeName: p.taxHistories[0]?.taxScheme?.name ?? null,
        categoryName: p.category?.name ?? null,
        pharmaceuticalFormName: p.pharmaceuticalForm?.name ?? null,
        commissionType: p.commissionType,
        commissionValue: p.commissionValue.toString(),
        commissionStartsAt: p.commissionStartsAt?.toISOString() ?? null,
        commissionEndsAt: p.commissionEndsAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Get a single product by id with full details (barcodes, active price,
   * active tax).
   *
   * @throws ProductNotFoundException if not found.
   */
  async getProduct(id: string): Promise<unknown> {
    this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        barcodes: {
          select: { id: true, barcode: true, barcodeType: true, isPrimary: true },
        },
        priceHistories: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
        costHistories: {
          where: { effectiveTo: null },
          select: { cost: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
        taxHistories: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          include: {
            taxScheme: { select: { id: true, code: true, name: true, taxType: true, rate: true } },
          },
        },
        category: { select: { id: true, name: true } },
        pharmaceuticalForm: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, displayName: true } },
      },
    });

    if (!product) throw new ProductNotFoundException(id);
    return product;
  }

  /**
   * Find a product by its internalCode.
   *
   * @returns The product or null if not found.
   */
  async getProductByCode(internalCode: string): Promise<ProductSearchResult | null> {
    this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    const product = await this.prisma.product.findUnique({
      where: { internalCode },
      include: {
        priceHistories: {
          where: { effectiveTo: null },
          select: { price: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
        costHistories: {
          where: { effectiveTo: null },
          select: { cost: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });

    if (!product) return null;

    return {
      id: product.id,
      internalCode: product.internalCode,
      commercialName: product.commercialName,
      concentration: product.concentration,
      laboratory: product.laboratory,
      saleType: product.saleType as SaleType,
      isActive: product.isActive,
      currentPrice: product.priceHistories[0]?.price.toString() ?? null,
      currentCost: product.costHistories[0]?.cost.toString() ?? null,
      commissionType: product.commissionType,
      commissionValue: product.commissionValue.toString(),
      commissionStartsAt: product.commissionStartsAt?.toISOString() ?? null,
      commissionEndsAt: product.commissionEndsAt?.toISOString() ?? null,
    };
  }

  /**
   * Search products by barcode value.
   *
   * Useful for barcode scanning — returns the product whose barcode set
   * includes the given value.
   */
  async getProductByBarcode(barcode: string): Promise<ProductSearchResult | null> {
    this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    const product = await this.prisma.product.findFirst({
      where: {
        barcodes: { some: { barcode } },
      },
      include: {
        priceHistories: {
          where: { effectiveTo: null },
          select: { price: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
        costHistories: {
          where: { effectiveTo: null },
          select: { cost: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });

    if (!product) return null;

    return {
      id: product.id,
      internalCode: product.internalCode,
      commercialName: product.commercialName,
      concentration: product.concentration,
      laboratory: product.laboratory,
      saleType: product.saleType as SaleType,
      isActive: product.isActive,
      currentPrice: product.priceHistories[0]?.price.toString() ?? null,
      currentCost: product.costHistories[0]?.cost.toString() ?? null,
      commissionType: product.commissionType,
      commissionValue: product.commissionValue.toString(),
      commissionStartsAt: product.commissionStartsAt?.toISOString() ?? null,
      commissionEndsAt: product.commissionEndsAt?.toISOString() ?? null,
    };
  }

  /**
   * Create a new product locally.
   *
   * Requires INVENTORY_ASSISTANT or ADMIN role.
   *
   * 1. Generates an OFFLINE-{uuid} internalCode for offline-created products.
   * 2. Validates that primary barcode is not a duplicate.
   * 3. Validates that every reference id is a non-empty string that is
   *    not a `seed-` local-only id, AND exists in the local cache (tax
   *    scheme is required; form/category optional). Fails fast with
   *    `UnsyncedReferenceException` (reason `local_seed_id` or
   *    `not_in_local_cache`) so the operator sees the problem
   *    immediately rather than after a failed sync round-trip.
   * 4. Creates the product row with null price/tax pointers.
   * 5. Creates the initial ProductPriceHistory and ProductTaxHistory rows.
   * 6. Updates product with currentPriceId and currentTaxHistoryId.
   * 7. Inserts a SyncQueue row (PRODUCT_CREATION) inside the same transaction.
   *    The payload mirrors the server's `CreateProductDto` shape, with
   *    `initialPrice` and `initialTaxSchemeId` as flat top-level fields
   *    (not nested `price` / `tax` objects).
   *
   * @throws DuplicateBarcodeException if any barcode is already in use.
   * @throws UnsyncedReferenceException if a referenced tax scheme /
   *         pharmaceutical form / category is a `seed-` local-only id
   *         or is missing from the local cache.
   */
  async createProduct(input: CreateProductInput): Promise<unknown> {
    const session = this.auth.requireRole(
      RoleType.INVENTORY_ASSISTANT,
      RoleType.ADMIN,
    );

    // Pre-validate duplicate barcodes
    for (const bc of input.barcodes) {
      const existing = await this.prisma.productBarcode.findUnique({
        where: { barcode: bc.barcode },
        select: { id: true },
      });
      if (existing) {
        throw new DuplicateBarcodeException(bc.barcode);
      }
    }

    // Pre-validate commission configuration (value + window coherence).
    assertCommissionConfigValid(input);

    // Pre-validate reference ids.  These checks happen before the
    // transaction so a sync-incompatible reference fails the create
    // immediately instead of writing a local row that the sync engine
    // would later reject with a 422.
    const sanitizedPharmaceuticalFormId = sanitizeOptionalReferenceId(
      input.pharmaceuticalFormId,
      'pharmaceuticalForm',
    );
    const sanitizedCategoryId = sanitizeOptionalReferenceId(
      input.categoryId,
      'category',
    );
    const sanitizedTaxSchemeId = requireServerReferenceId(
      input.tax.taxSchemeId,
      'taxScheme',
    );

    await this.assertReferencesExist({
      taxSchemeId: sanitizedTaxSchemeId,
      pharmaceuticalFormId: sanitizedPharmaceuticalFormId,
      categoryId: sanitizedCategoryId,
    });

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const productId = globalThis.crypto.randomUUID();
      const internalCode = `OFFLINE-${globalThis.crypto.randomUUID()}`;

      // 1. Create product with null price/tax pointers
      const product = await tx.product.create({
        data: {
          id: productId,
          internalCode,
          commercialName: input.commercialName,
          concentration: input.concentration ?? null,
          concentrationUnit: input.concentrationUnit ?? null,
          laboratory: input.laboratory,
          saleType: input.saleType,
          minimumStock: input.minimumStock ?? 0,
          isActive: true,
          invimaRegistry: input.invimaRegistry ?? null,
          atcCode: input.atcCode ?? null,
          therapeuticIndication: input.therapeuticIndication ?? null,
          storageConditions: input.storageConditions ?? null,
          internalNotes: input.internalNotes ?? null,
          categoryId: sanitizedCategoryId ?? null,
          pharmaceuticalFormId: sanitizedPharmaceuticalFormId ?? null,
          commissionType: input.commissionType ?? CommissionType.NONE,
          commissionValue: input.commissionValue
            ? new Prisma.Decimal(input.commissionValue)
            : new Prisma.Decimal(0),
          commissionStartsAt: input.commissionStartsAt
            ? new Date(input.commissionStartsAt)
            : null,
          commissionEndsAt: input.commissionEndsAt
            ? new Date(input.commissionEndsAt)
            : null,
          createdById: session.userId,
        },
      });

      // 2. Create barcodes
      if (input.barcodes.length > 0) {
        await tx.productBarcode.createMany({
          data: input.barcodes.map((bc) => ({
            id: globalThis.crypto.randomUUID(),
            productId,
            barcode: bc.barcode,
            barcodeType: bc.barcodeType,
            isPrimary: bc.isPrimary ?? false,
          })),
        });
      }

      // 3. Create price history
      const priceHistoryId = globalThis.crypto.randomUUID();
      const effectiveFrom = input.price.effectiveFrom
        ? new Date(input.price.effectiveFrom)
        : now;

      await tx.productPriceHistory.create({
        data: {
          id: priceHistoryId,
          productId,
          price: new Prisma.Decimal(input.price.price),
          effectiveFrom,
          changedById: session.userId,
          changedAt: now,
          changeReason: input.price.changeReason ?? 'Initial price on creation',
        },
      });

      // 4. Create tax history
      const taxHistoryId = globalThis.crypto.randomUUID();
      const taxEffectiveFrom = input.tax.effectiveFrom
        ? new Date(input.tax.effectiveFrom)
        : now;

      await tx.productTaxHistory.create({
        data: {
          id: taxHistoryId,
          productId,
          taxSchemeId: sanitizedTaxSchemeId,
          effectiveFrom: taxEffectiveFrom,
          changedById: session.userId,
          changedAt: now,
          changeReason: input.tax.changeReason ?? 'Initial tax on creation',
        },
      });

      // 4b. Create initial cost history (if provided)
      let costHistoryId: string | null = null;
      let costEffectiveFrom: Date = now;
      if (input.initialCost) {
        costHistoryId = globalThis.crypto.randomUUID();
        costEffectiveFrom = input.initialCost.effectiveFrom
          ? new Date(input.initialCost.effectiveFrom)
          : now;

        await tx.productCostHistory.create({
          data: {
            id: costHistoryId,
            productId,
            cost: new Prisma.Decimal(input.initialCost.cost),
            effectiveFrom: costEffectiveFrom,
            changedById: session.userId,
            changedAt: now,
            changeReason: input.initialCost.changeReason ?? 'Initial cost on creation',
          },
        });
      }

      // 5. Update product with price/tax/cost pointers
      const updatePointers: Record<string, string> = {
        currentPriceId: priceHistoryId,
        currentTaxHistoryId: taxHistoryId,
      };
      if (costHistoryId) {
        updatePointers.currentCostId = costHistoryId;
      }

      await tx.product.update({
        where: { id: productId },
        data: updatePointers,
      });

      // 6. Build the sync payload in the server's CreateProductDto shape.
      // Note: `initialPrice` and `initialTaxSchemeId` are flat top-level
      // fields — the server's Zod schema rejects nested `price`/`tax`
      // objects with "expected string, received undefined" / "must be
      // a valid UUID".
      const createProductDto: Record<string, unknown> = {
        internalCode,
        commercialName: input.commercialName,
        concentration: input.concentration ?? undefined,
        concentrationUnit: input.concentrationUnit ?? undefined,
        laboratory: input.laboratory,
        saleType: input.saleType,
        minimumStock: input.minimumStock ?? 0,
        invimaRegistry: input.invimaRegistry ?? undefined,
        atcCode: input.atcCode ?? undefined,
        therapeuticIndication: input.therapeuticIndication ?? undefined,
        storageConditions: input.storageConditions ?? undefined,
        internalNotes: input.internalNotes ?? undefined,
        categoryId: sanitizedCategoryId,
        pharmaceuticalFormId: sanitizedPharmaceuticalFormId,
        // Commission config mirrors the server's CreateProductSchema
        // (see the backend agent's create-product.dto.ts). NONE is sent
        // explicitly so the server row matches the local row exactly.
        commissionType: input.commissionType ?? CommissionType.NONE,
        commissionValue: input.commissionValue
          ? new Prisma.Decimal(input.commissionValue).toString()
          : '0',
        commissionStartsAt: input.commissionStartsAt
          ? new Date(input.commissionStartsAt).toISOString()
          : undefined,
        commissionEndsAt: input.commissionEndsAt
          ? new Date(input.commissionEndsAt).toISOString()
          : undefined,
        initialPrice: new Prisma.Decimal(input.price.price).toString(),
        initialTaxSchemeId: sanitizedTaxSchemeId,
        barcodes: input.barcodes.map((bc) => ({
          barcode: bc.barcode,
          barcodeType: bc.barcodeType,
          isPrimary: bc.isPrimary ?? false,
        })),
      };

      const syncPayload = {
        operationType: 'PRODUCT_CREATION' as const,
        userId: session.userId,
        createProductDto,
        metadata: {
          productId,
          workstationId: session.workstationId,
          createdAt: now.toISOString(),
        },
      };

      await this.createSyncQueueEntry(
        tx,
        session,
        'PRODUCT_CREATION',
        syncPayload,
        now,
      );

      return {
        ...product,
        currentPriceId: priceHistoryId,
        currentTaxHistoryId: taxHistoryId,
      };
    }).then((result) => {
      notifyPendingEntry();
      return result;
    });
  }

  /**
   * Scan the local `Product` table for rows that have never been pushed
   * to the server (`serverId IS NULL` AND a provisional `OFFLINE-` internalCode)
   * and enqueue a `PRODUCT_CREATION` SyncQueue entry for each one.
   *
   * This is the backstop for products that were created offline by
   * `createProduct` but whose sync entry never reached `COMPLETED` —
   * either because the original `createProduct` happened before the
   * payload-shape fix landed, because a prior sync push failed with
   * `PERMANENT_FAILURE` and the operator has not yet used the recovery
   * page, or because a backup-restore cycle left the local DB with
   * products but no corresponding SyncQueue rows. The scheduler calls
   * this on every reconnect so the unsynced products are guaranteed to
   * land in the queue before the first `SALE_CONFIRMATION` for any of
   * them does (the sales-pos service blocks those sales outright, but
   * the queue drain is what actually unblocks the cashier).
   *
   * Skips any product that already has an active (PENDING / FAILED /
   * PROCESSING) SyncQueue PRODUCT_CREATION row referencing it — those
   * are already in the push pipeline and the server's
   * `internalCode`-based idempotency will fold the rows together.
   *
   * No role check: this is an internal sync primitive invoked by the
   * scheduler, not a user-facing endpoint. The role check that matters
   * already ran when the product was first created.
   *
   * @returns Count of newly enqueued products.
   */
  async enqueueUnsyncedProducts(): Promise<{ enqueued: number }> {
    const orphanProducts = await this.prisma.product.findMany({
      where: {
        serverId: null,
        internalCode: { startsWith: 'OFFLINE-' },
      },
      select: { id: true },
    });

    if (orphanProducts.length === 0) {
      return { enqueued: 0 };
    }

    // Find any PRODUCT_CREATION row that is still in flight for the
    // local workstation. We can't filter on `metadata.productId` (it
    // lives inside the JSON payload, not a column) so we load the
    // payloads and parse them in memory — the active queue is bounded
    // by the batch size and even a full day of PENDING entries is
    // small enough for in-process filtering.
    const activeQueueEntries = await this.prisma.syncQueue.findMany({
      where: {
        operationType: 'PRODUCT_CREATION',
        status: { in: ['PENDING', 'FAILED', 'PROCESSING'] },
      },
      select: { payload: true },
    });

    const inFlightProductIds = new Set<string>();
    for (const entry of activeQueueEntries) {
      const productId = extractMetadataProductId(entry.payload);
      if (productId !== null) {
        inFlightProductIds.add(productId);
      }
    }

    const needsEnqueue = orphanProducts
      .map((p) => p.id)
      .filter((id) => !inFlightProductIds.has(id));

    if (needsEnqueue.length === 0) {
      return { enqueued: 0 };
    }

    const enqueued = await this.prisma.$transaction(async (tx) => {
      let count = 0;
      for (const productId of needsEnqueue) {
        const product = await this.loadProductForReconciliation(
          tx,
          productId,
        );
        if (product === null) {
          // Row vanished between the scan and the transaction — nothing
          // to do, skip it.
          continue;
        }

        const payloadObj = this.buildCreateProductPayloadFromRow(
          product,
          product.session,
          product.workstationId,
        );

        // Re-use the same SyncQueue entry shape that createProduct
        // produces, so the server's batch dispatcher treats the entry
        // identically.  We pass the original product creation timestamp
        // through `sourceCreatedAt` so the client's monotonic sequence
        // numbers are preserved correctly.
        const sourceCreatedAt = product.createdAt;
        await this.createSyncQueueEntry(
          tx,
          { userId: product.createdById, workstationId: product.workstationId },
          'PRODUCT_CREATION',
          payloadObj,
          sourceCreatedAt,
        );
        count += 1;
      }
      return count;
    });

    if (enqueued > 0) {
      notifyPendingEntry();
    }

    return { enqueued };
  }

  /**
   * Update an existing product.
   *
   * Requires INVENTORY_ASSISTANT or ADMIN role.
   *
   * Supports partial field updates, barcode replacement, and optional new
   * price/tax history entries.
   *
   * @throws ProductNotFoundException if the product does not exist.
   * @throws ProductUpdateException if a barcode conflict occurs.
   */
  async updateProduct(
    id: string,
    input: UpdateProductInput,
  ): Promise<unknown> {
    const session = this.auth.requireRole(
      RoleType.INVENTORY_ASSISTANT,
      RoleType.ADMIN,
    );

    // Verify existence
    const existing = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true, currentPriceId: true, currentTaxHistoryId: true, currentCostId: true },
    });
    if (!existing) throw new ProductNotFoundException(id);

    // Pre-validate commission configuration (value + window coherence).
    assertCommissionConfigValid(input);

    // Sanitize optional reference ids.  Same rule as createProduct:
    // empty strings are dropped (so the server skips the optional field
    // instead of rejecting it as "must not be empty") and `seed-*`
    // local-only ids fail fast with `UnsyncedReferenceException`.  We
    // only validate the presence of categoryId / pharmaceuticalFormId
    // if a value is actually being changed.
    const sanitizedCategoryId =
      input.categoryId !== undefined
        ? sanitizeOptionalReferenceId(input.categoryId, 'category')
        : undefined;
    const sanitizedPharmaceuticalFormId =
      input.pharmaceuticalFormId !== undefined
        ? sanitizeOptionalReferenceId(
            input.pharmaceuticalFormId,
            'pharmaceuticalForm',
          )
        : undefined;
    if (sanitizedCategoryId !== undefined) {
      await this.assertReferenceExists(
        'category',
        sanitizedCategoryId,
      );
    }
    if (sanitizedPharmaceuticalFormId !== undefined) {
      await this.assertReferenceExists(
        'pharmaceuticalForm',
        sanitizedPharmaceuticalFormId,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // 1. Update scalar fields
      const updateData: Prisma.ProductUpdateInput = {};

      if (input.commercialName !== undefined) updateData.commercialName = input.commercialName;
      if (input.concentration !== undefined) updateData.concentration = input.concentration;
      if (input.concentrationUnit !== undefined) updateData.concentrationUnit = input.concentrationUnit;
      if (input.laboratory !== undefined) updateData.laboratory = input.laboratory;
      if (input.saleType !== undefined) updateData.saleType = input.saleType;
      if (input.minimumStock !== undefined) updateData.minimumStock = input.minimumStock;
      if (input.invimaRegistry !== undefined) updateData.invimaRegistry = input.invimaRegistry;
      if (input.atcCode !== undefined) updateData.atcCode = input.atcCode;
      if (input.therapeuticIndication !== undefined) updateData.therapeuticIndication = input.therapeuticIndication;
      if (input.storageConditions !== undefined) updateData.storageConditions = input.storageConditions;
      if (input.internalNotes !== undefined) updateData.internalNotes = input.internalNotes;
      if (input.commissionType !== undefined) updateData.commissionType = input.commissionType;
      if (input.commissionValue !== undefined) {
        updateData.commissionValue = new Prisma.Decimal(input.commissionValue);
      }
      if (input.commissionStartsAt !== undefined) {
        updateData.commissionStartsAt = input.commissionStartsAt
          ? new Date(input.commissionStartsAt)
          : null;
      }
      if (input.commissionEndsAt !== undefined) {
        updateData.commissionEndsAt = input.commissionEndsAt
          ? new Date(input.commissionEndsAt)
          : null;
      }
      if (sanitizedCategoryId !== undefined) {
        updateData.category = { connect: { id: sanitizedCategoryId } };
      }
      if (sanitizedPharmaceuticalFormId !== undefined) {
        updateData.pharmaceuticalForm = { connect: { id: sanitizedPharmaceuticalFormId } };
      }

      // 2. Handle barcode replacement (if provided, full replace)
      if (input.barcodes) {
        // Validate no duplicate barcodes across other products
        for (const bc of input.barcodes) {
          const conflict = await tx.productBarcode.findFirst({
            where: {
              barcode: bc.barcode,
              productId: { not: id },
            },
            select: { id: true },
          });
          if (conflict) {
            throw new ProductUpdateException(
              id,
              `Barcode ${bc.barcode} is already assigned to another product.`,
            );
          }
        }

        // Delete existing barcodes for this product
        await tx.productBarcode.deleteMany({ where: { productId: id } });

        // Create new barcodes
        if (input.barcodes.length > 0) {
          await tx.productBarcode.createMany({
            data: input.barcodes.map((bc) => ({
              id: globalThis.crypto.randomUUID(),
              productId: id,
              barcode: bc.barcode,
              barcodeType: bc.barcodeType,
              isPrimary: bc.isPrimary ?? false,
            })),
          });
        }
      }

      // 3. Handle new price entry
      if (input.newPrice) {
        // Expire current active price
        if (existing.currentPriceId) {
          await tx.productPriceHistory.update({
            where: { id: existing.currentPriceId },
            data: { effectiveTo: now },
          });
        }

        // Create new price history
        const newPriceHistoryId = globalThis.crypto.randomUUID();
        const priceEffectiveFrom = input.newPrice.effectiveFrom
          ? new Date(input.newPrice.effectiveFrom)
          : now;

        await tx.productPriceHistory.create({
          data: {
            id: newPriceHistoryId,
            productId: id,
            previousPriceHistoryId: existing.currentPriceId ?? null,
            price: new Prisma.Decimal(input.newPrice.price),
            effectiveFrom: priceEffectiveFrom,
            changedById: session.userId,
            changedAt: now,
            changeReason: input.newPrice.changeReason ?? null,
          },
        });

        updateData.currentPriceId = newPriceHistoryId;
      }

      // 4. Handle new cost entry
      if (input.newCost) {
        // Expire current active cost
        if (existing.currentCostId) {
          await tx.productCostHistory.update({
            where: { id: existing.currentCostId },
            data: { effectiveTo: now },
          });
        }

        // Create new cost history
        const newCostHistoryId = globalThis.crypto.randomUUID();
        const costEffectiveFrom = input.newCost.effectiveFrom
          ? new Date(input.newCost.effectiveFrom)
          : now;

        await tx.productCostHistory.create({
          data: {
            id: newCostHistoryId,
            productId: id,
            previousCostHistoryId: existing.currentCostId ?? null,
            cost: new Prisma.Decimal(input.newCost.cost),
            effectiveFrom: costEffectiveFrom,
            changedById: session.userId,
            changedAt: now,
            changeReason: input.newCost.changeReason ?? null,
          },
        });

        updateData.currentCostId = newCostHistoryId;
      }

      // 5. Handle new tax entry
      if (input.newTax) {
        // Expire current active tax
        if (existing.currentTaxHistoryId) {
          await tx.productTaxHistory.update({
            where: { id: existing.currentTaxHistoryId },
            data: { effectiveTo: now },
          });
        }

        // Create new tax history
        const newTaxHistoryId = globalThis.crypto.randomUUID();
        const taxEffectiveFrom = input.newTax.effectiveFrom
          ? new Date(input.newTax.effectiveFrom)
          : now;

        await tx.productTaxHistory.create({
          data: {
            id: newTaxHistoryId,
            productId: id,
            previousTaxHistoryId: existing.currentTaxHistoryId ?? null,
            taxSchemeId: input.newTax.taxSchemeId,
            effectiveFrom: taxEffectiveFrom,
            changedById: session.userId,
            changedAt: now,
            changeReason: input.newTax.changeReason ?? null,
          },
        });

        updateData.currentTaxHistoryId = newTaxHistoryId;
      }

      // 5. Apply updates
      const updated = await tx.product.update({
        where: { id },
        data: updateData,
      });

      // 6. Create sync queue entry
      //
      // Price and cost changes (`initialPrice`, `initialCost`) are
      // included so the server creates matching history entries.
      // Tax changes remain local and replay through
      // assign-product-tax-scheme.
      const syncPayload = {
        operationType: 'PRODUCT_UPDATE' as const,
        userId: session.userId,
        productId: id,
        updateProductDto: {
          internalCode: updated.internalCode,
          ...(input.commercialName !== undefined && { commercialName: input.commercialName }),
          ...(input.concentration !== undefined && { concentration: input.concentration }),
          ...(input.concentrationUnit !== undefined && { concentrationUnit: input.concentrationUnit }),
          ...(input.laboratory !== undefined && { laboratory: input.laboratory }),
          ...(input.saleType !== undefined && { saleType: input.saleType }),
          ...(input.minimumStock !== undefined && { minimumStock: input.minimumStock }),
          ...(input.invimaRegistry !== undefined && { invimaRegistry: input.invimaRegistry }),
          ...(input.atcCode !== undefined && { atcCode: input.atcCode }),
          ...(input.therapeuticIndication !== undefined && { therapeuticIndication: input.therapeuticIndication }),
          ...(input.storageConditions !== undefined && { storageConditions: input.storageConditions }),
          ...(input.internalNotes !== undefined && { internalNotes: input.internalNotes }),
          ...(input.commissionType !== undefined && { commissionType: input.commissionType }),
          ...(input.commissionValue !== undefined && {
            commissionValue: new Prisma.Decimal(input.commissionValue).toString(),
          }),
          ...(input.commissionStartsAt !== undefined && {
            commissionStartsAt: input.commissionStartsAt
              ? new Date(input.commissionStartsAt).toISOString()
              : null,
          }),
          ...(input.commissionEndsAt !== undefined && {
            commissionEndsAt: input.commissionEndsAt
              ? new Date(input.commissionEndsAt).toISOString()
              : null,
          }),
          ...(sanitizedCategoryId !== undefined && { categoryId: sanitizedCategoryId }),
          ...(sanitizedPharmaceuticalFormId !== undefined && {
            pharmaceuticalFormId: sanitizedPharmaceuticalFormId,
          }),
          ...(input.newPrice?.price !== undefined && { initialPrice: new Prisma.Decimal(input.newPrice.price).toString() }),
          ...(input.newCost?.cost !== undefined && { initialCost: new Prisma.Decimal(input.newCost.cost).toString() }),
          ...(input.newTax?.taxSchemeId !== undefined && { initialTaxSchemeId: input.newTax.taxSchemeId }),
          ...(input.barcodes && {
            barcodes: input.barcodes.map((bc) => ({
              barcode: bc.barcode,
              barcodeType: bc.barcodeType,
              isPrimary: bc.isPrimary ?? false,
            })),
          }),
        },
        metadata: {
          productId: id,
          workstationId: session.workstationId,
          updatedAt: now.toISOString(),
        },
      };

      await this.createSyncQueueEntry(
        tx,
        session,
        'PRODUCT_UPDATE',
        syncPayload,
        now,
      );

      return updated;
    }).then((result) => {
      notifyPendingEntry();
      return result;
    });
  }

  /**
   * Soft-delete a product by setting `isActive = false`.
   *
   * Requires INVENTORY_ASSISTANT or ADMIN role.
   *
   * Does NOT create a SyncQueue entry — the server is notified of the
   * deactivation through the next PRODUCT_UPDATE sync or a dedicated
   * deactivation sync that this service enqueues as a PRODUCT_UPDATE
   * with `isActive: false`.
   *
   * @throws ProductNotFoundException if the product does not exist.
   */
  async softDeleteProduct(id: string): Promise<void> {
    const session = this.auth.requireRole(
      RoleType.INVENTORY_ASSISTANT,
      RoleType.ADMIN,
    );

    const existing = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true, isActive: true, internalCode: true },
    });
    if (!existing) throw new ProductNotFoundException(id);
    if (!existing.isActive) return; // Already inactive

    await this.prisma.product.update({
      where: { id },
      data: {
        isActive: false,
        discontinuationReason: 'Soft-deleted from POS',
      },
    });

    // Create sync entry so the server learns about the deactivation
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const syncPayload = {
        operationType: 'PRODUCT_UPDATE' as const,
        userId: session.userId,
        updateProductDto: {
          internalCode: existing.internalCode,
          isActive: false,
          discontinuationReason: 'Soft-deleted from POS',
        },
        metadata: {
          productId: id,
          workstationId: session.workstationId,
          updatedAt: now.toISOString(),
        },
      };

      await this.createSyncQueueEntry(
        tx,
        session,
        'PRODUCT_UPDATE',
        syncPayload,
        now,
      );
    }).then(() => {
      notifyPendingEntry();
    });
  }

  /**
   * Update the current cost (CPP) of a product.
   *
   * Creates a new ProductCostHistory entry, expires the previous one,
   * and updates `currentCostId`. Does NOT create a SyncQueue entry —
   * cost updates are side effects of purchase receptions and are synced
   * as part of the reception confirmation payload.
   *
   * Requires INVENTORY_ASSISTANT or ADMIN role.
   *
   * @throws ProductNotFoundException if the product does not exist.
   */
  async updateProductCost(
    productId: string,
    newCost: number | string | Prisma.Decimal,
    changedById: string,
    changeReason?: string,
  ): Promise<void> {
    this.auth.requireRole(
      RoleType.INVENTORY_ASSISTANT,
      RoleType.ADMIN,
    );

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, currentCostId: true },
    });
    if (!product) throw new ProductNotFoundException(productId);

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // Expire current active cost
      if (product.currentCostId) {
        await tx.productCostHistory.update({
          where: { id: product.currentCostId },
          data: { effectiveTo: now },
        });
      }

      // Create new cost history
      const newCostHistoryId = globalThis.crypto.randomUUID();
      await tx.productCostHistory.create({
        data: {
          id: newCostHistoryId,
          productId,
          previousCostHistoryId: product.currentCostId ?? null,
          cost: new Prisma.Decimal(newCost),
          effectiveFrom: now,
          changedById,
          changedAt: now,
          changeReason: changeReason ?? 'CPP updated after purchase reception',
        },
      });

      // Update product pointer
      await tx.product.update({
        where: { id: productId },
        data: { currentCostId: newCostHistoryId },
      });
    });
  }

  /**
   * Get the current cost of a product.
   *
   * @returns The current cost as a decimal string, or null if no cost has been set.
   */
  async getCurrentCost(productId: string): Promise<string | null> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        costHistories: {
          where: { effectiveTo: null },
          select: { cost: true },
          take: 1,
        },
      },
    });
    if (!product) throw new ProductNotFoundException(productId);
    return product.costHistories[0]?.cost.toString() ?? null;
  }

  // -------------------------------------------------------------------------
  // Private — reference validation
  // -------------------------------------------------------------------------

  /**
   * Verify that every reference id is present in the local cache.
   *
   * The local cache is the authoritative source for reference ids on the
   * POS: a row only lands in the local `taxScheme` / `pharmaceuticalForm`
   * / `category` table after a successful pull-sync, which means the
   * server already knows about it.  If the row is missing here, sending
   * the id to the server would fail with a 422 (unknown id) or, worse,
   * a 500 (FK violation when the server tries to create the history).
   *
   * Throws `UnsyncedReferenceException` with `not_in_local_cache` so the
   * UI can prompt the operator to wait for / trigger a pull-sync.
   */
  private async assertReferencesExist(refs: {
    taxSchemeId: string;
    pharmaceuticalFormId?: string;
    categoryId?: string;
  }): Promise<void> {
    const checks: Array<Promise<unknown>> = [
      this.assertReferenceExists('taxScheme', refs.taxSchemeId),
    ];
    if (refs.pharmaceuticalFormId) {
      checks.push(
        this.assertReferenceExists(
          'pharmaceuticalForm',
          refs.pharmaceuticalFormId,
        ),
      );
    }
    if (refs.categoryId) {
      checks.push(this.assertReferenceExists('category', refs.categoryId));
    }
    await Promise.all(checks);
  }

  private async assertReferenceExists(
    referenceType: 'taxScheme' | 'pharmaceuticalForm' | 'category',
    referenceId: string,
  ): Promise<void> {
    let row: { id: string } | null = null;
    if (referenceType === 'taxScheme') {
      row = await this.prisma.taxScheme.findUnique({
        where: { id: referenceId },
        select: { id: true },
      });
    } else if (referenceType === 'pharmaceuticalForm') {
      row = await this.prisma.pharmaceuticalForm.findUnique({
        where: { id: referenceId },
        select: { id: true },
      });
    } else {
      row = await this.prisma.category.findUnique({
        where: { id: referenceId },
        select: { id: true },
      });
    }
    if (!row) {
      throw new UnsyncedReferenceException(
        referenceType,
        referenceId,
        'not_in_local_cache',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Private — sync helpers
  // -------------------------------------------------------------------------

  /**
   * Load a product and the data needed to rebuild a server-side
   * `createProductDto` payload from the stored row. Returns null when
   * the row is missing or has no current price/tax history — the latter
   * means the product was created in a partially-valid state and a
   * manual fix is required.
   *
   * The returned `session`/`workstationId` are best-effort echoes from
   * the stored row so the SyncQueue entry's `metadata` field has the
   * same workstation attribution the original `createProduct` call
   * produced.
   */
  private async loadProductForReconciliation(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<{
    id: string;
    internalCode: string;
    commercialName: string;
    concentration: string | null;
    concentrationUnit: string | null;
    laboratory: string;
    saleType: SaleType;
    minimumStock: number;
    invimaRegistry: string | null;
    atcCode: string | null;
    therapeuticIndication: string | null;
    storageConditions: string | null;
    internalNotes: string | null;
    categoryId: string | null;
    pharmaceuticalFormId: string | null;
    barcodes: Array<{ barcode: string; barcodeType: string; isPrimary: boolean }>;
    initialPrice: string;
    initialTaxSchemeId: string;
    commissionType: CommissionType;
    commissionValue: string;
    commissionStartsAt: Date | null;
    commissionEndsAt: Date | null;
    createdById: string;
    createdAt: Date;
    session: { userId: string; workstationId: string };
    workstationId: string;
  } | null> {    const row = await tx.product.findUnique({
      where: { id: productId },
      select: {
        // Scalar fields needed for the payload — `serverId` is also
        // selected here (rather than via `include`) because the
        // generated client's `include` type doesn't surface
        // `serverId` even though the runtime column exists. The
        // same field is read by `enqueueUnsyncedProducts` to skip
        // already-reconciled rows.
        serverId: true,
        id: true,
        internalCode: true,
        commercialName: true,
        concentration: true,
        concentrationUnit: true,
        laboratory: true,
        saleType: true,
        minimumStock: true,
        invimaRegistry: true,
        atcCode: true,
        therapeuticIndication: true,
        storageConditions: true,
        internalNotes: true,
        categoryId: true,
        pharmaceuticalFormId: true,
        createdById: true,
        createdAt: true,
        commissionType: true,
        commissionValue: true,
        commissionStartsAt: true,
        commissionEndsAt: true,
        barcodes: {
          select: { barcode: true, barcodeType: true, isPrimary: true },
        },
        priceHistories: {
          where: { effectiveTo: null },
          take: 1,
          orderBy: { effectiveFrom: 'desc' },
          select: { price: true },
        },
        taxHistories: {
          where: { effectiveTo: null },
          take: 1,
          orderBy: { effectiveFrom: 'desc' },
          select: { taxSchemeId: true },
        },
        costHistories: {
          where: { effectiveTo: null },
          take: 1,
          orderBy: { effectiveFrom: 'desc' },
          select: { cost: true },
        },
      },
    });

    if (!row) return null;
    if (row.priceHistories.length === 0) return null;
    if (row.taxHistories.length === 0) return null;
    if (row.serverId !== null) return null; // raced with another reconciliation pass

    // We don't store a workstationId column on Product — the only
    // workstation attribution we have is from the SyncQueue row(s)
    // that reference this product.  Fall back to the
    // `metadata.workstationId` of the most recent in-flight entry, or
    // to a stable placeholder if none exists yet (the scheduler that
    // pulls this never validates the metadata workstationId against
    // the live session, so a missing value is harmless).
    const lastEntry = await tx.syncQueue.findFirst({
      where: {
        operationType: 'PRODUCT_CREATION',
        payload: { contains: productId },
      },
      orderBy: { clientSequence: 'desc' },
      select: { payload: true },
    });
    const lastWorkstationId = lastEntry
      ? extractMetadataWorkstationId(lastEntry.payload)
      : null;

    return {
      id: row.id,
      internalCode: row.internalCode,
      commercialName: row.commercialName,
      concentration: row.concentration,
      concentrationUnit: row.concentrationUnit,
      laboratory: row.laboratory,
      saleType: row.saleType as SaleType,
      minimumStock: row.minimumStock,
      invimaRegistry: row.invimaRegistry,
      atcCode: row.atcCode,
      therapeuticIndication: row.therapeuticIndication,
      storageConditions: row.storageConditions,
      internalNotes: row.internalNotes,
      categoryId: row.categoryId,
      pharmaceuticalFormId: row.pharmaceuticalFormId,
      barcodes: row.barcodes.map((bc) => ({
        barcode: bc.barcode,
        barcodeType: bc.barcodeType as string,
        isPrimary: bc.isPrimary,
      })),
      initialPrice: row.priceHistories[0].price.toString(),
      initialTaxSchemeId: row.taxHistories[0].taxSchemeId,
      commissionType: row.commissionType,
      commissionValue: row.commissionValue.toString(),
      commissionStartsAt: row.commissionStartsAt,
      commissionEndsAt: row.commissionEndsAt,
      createdById: row.createdById,
      createdAt: row.createdAt,
      session: { userId: row.createdById, workstationId: lastWorkstationId ?? 'unknown' },
      workstationId: lastWorkstationId ?? 'unknown',
    };
  }

  /**
   * Build a `createProductDto` payload (and SyncQueue metadata) from a
   * stored Product row, matching the shape `createProduct` produces.
   *
   * Kept separate from `createProduct`'s inline construction so the
   * two paths can never drift: any change to the server-side
   * `CreateProductDto` contract must be applied here too, and the
   * shared `// NOTE:` comment in `createProduct` is the cross-reference
   * the next developer will grep for.
   */
  private buildCreateProductPayloadFromRow(
    row: {
      id: string;
      internalCode: string;
      commercialName: string;
      concentration: string | null;
      concentrationUnit: string | null;
      laboratory: string;
      saleType: SaleType;
      minimumStock: number;
      invimaRegistry: string | null;
      atcCode: string | null;
      therapeuticIndication: string | null;
      storageConditions: string | null;
      internalNotes: string | null;
      categoryId: string | null;
      pharmaceuticalFormId: string | null;
      barcodes: Array<{ barcode: string; barcodeType: string; isPrimary: boolean }>;
      initialPrice: string;
      initialTaxSchemeId: string;
      commissionType: CommissionType;
      commissionValue: string;
      commissionStartsAt: Date | null;
      commissionEndsAt: Date | null;
      createdAt: Date;
    },
    session: { userId: string; workstationId: string },
    workstationId: string,
  ): Record<string, unknown> {
    // Mirrors the createProductDto block in createProduct — keep both
    // in sync. `initialPrice` and `initialTaxSchemeId` are flat
    // top-level fields; the server's Zod schema rejects nested
    // `price`/`tax` objects.
    const createProductDto: Record<string, unknown> = {
      internalCode: row.internalCode,
      commercialName: row.commercialName,
      concentration: row.concentration ?? undefined,
      concentrationUnit: row.concentrationUnit ?? undefined,
      laboratory: row.laboratory,
      saleType: row.saleType,
      minimumStock: row.minimumStock,
      invimaRegistry: row.invimaRegistry ?? undefined,
      atcCode: row.atcCode ?? undefined,
      therapeuticIndication: row.therapeuticIndication ?? undefined,
      storageConditions: row.storageConditions ?? undefined,
      internalNotes: row.internalNotes ?? undefined,
      categoryId: row.categoryId ?? undefined,
      pharmaceuticalFormId: row.pharmaceuticalFormId ?? undefined,
      commissionType: row.commissionType,
      commissionValue: row.commissionValue,
      commissionStartsAt: row.commissionStartsAt?.toISOString() ?? undefined,
      commissionEndsAt: row.commissionEndsAt?.toISOString() ?? undefined,
      initialPrice: row.initialPrice,
      initialTaxSchemeId: row.initialTaxSchemeId,
      barcodes: row.barcodes.map((bc) => ({
        barcode: bc.barcode,
        barcodeType: bc.barcodeType,
        isPrimary: bc.isPrimary,
      })),
    };

    return {
      operationType: 'PRODUCT_CREATION' as const,
      userId: session.userId,
      createProductDto,
      metadata: {
        productId: row.id,
        workstationId,
        createdAt: row.createdAt.toISOString(),
      },
    };
  }

  private async createSyncQueueEntry(
    tx: Prisma.TransactionClient,
    session: { userId: string; workstationId: string },
    operationType: 'PRODUCT_CREATION' | 'PRODUCT_UPDATE',
    payloadObj: Record<string, unknown>,
    sourceCreatedAt: Date,
  ): Promise<void> {
    const payload = JSON.stringify(payloadObj);
    const payloadBytes = new TextEncoder().encode(payload);
    const payloadSize = payloadBytes.length;
    const payloadHash = await this.computePayloadHash(payload);
    const operationUuid = globalThis.crypto.randomUUID();

    const latestSeq = await tx.syncQueue.findFirst({
      where: { sourceWorkstationId: session.workstationId },
      orderBy: { clientSequence: 'desc' },
      select: { clientSequence: true },
    });
    const clientSequence = latestSeq ? latestSeq.clientSequence + 1n : 1n;

    await tx.syncQueue.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        operationUuid,
        operationType,
        payload,
        payloadHash,
        payloadSize,
        versionSchema: 1,
        status: 'PENDING',
        retryCount: 0,
        sourceWorkstationId: session.workstationId,
        sourceCreatedAt,
        clientSequence,
      },
    });
  }

  private async computePayloadHash(payload: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers — payload parsing
// ---------------------------------------------------------------------------

/**
 * Safely extract `metadata.productId` from a SyncQueue payload string.
 * Returns `null` when the payload can't be parsed or doesn't contain
 * the expected field — callers treat null as "no claim, do not skip".
 *
 * Only used by `enqueueUnsyncedProducts` to filter the active
 * SyncQueue entries down to "ones that already represent this orphan
 * product"; production paths must always build payloads through
 * `createProduct` rather than parsing them.
 */
function extractMetadataProductId(payload: string): string | null {
  return extractMetadataField(payload, 'productId');
}

function extractMetadataWorkstationId(payload: string): string | null {
  return extractMetadataField(payload, 'workstationId');
}

function extractMetadataField(
  payload: string,
  field: 'productId' | 'workstationId',
): string | null {
  try {
    const parsed = JSON.parse(payload) as {
      metadata?: Record<string, unknown>;
    };
    const value = parsed.metadata?.[field];
    if (typeof value !== 'string' || value.length === 0) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}
