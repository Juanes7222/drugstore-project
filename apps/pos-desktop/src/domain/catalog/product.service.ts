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
 */
import { PrismaClient, Prisma, SaleType } from '@pharmacy/database/local';
import type { AuthService } from '../auth/auth.service';
import { RoleType } from '@pharmacy/shared-types';
import {
  ProductNotFoundException,
  ProductCreationException,
  ProductUpdateException,
  DuplicateBarcodeException,
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

export interface CreateProductTaxInput {
  taxSchemeId: string;
  effectiveFrom?: Date | string;
  changeReason?: string;
}

export interface CreateProductInput {
  commercialName: string;
  genericName: string;
  activePrinciple: string;
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
  /** Default price entry. Required for offline creation. */
  price: CreateProductPriceInput;
  /** Default tax entry. Required for offline creation. */
  tax: CreateProductTaxInput;
  /** Initial barcodes (must include at least one primary). */
  barcodes: ProductBarcodeInput[];
}

export interface UpdateProductInput {
  commercialName?: string;
  genericName?: string;
  activePrinciple?: string;
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
  /** If set, replaces the full barcode set (delete stale, upsert new). */
  barcodes?: ProductBarcodeInput[];
  /** New price entry (creates a new ProductPriceHistory, updates currentPriceId). */
  newPrice?: CreateProductPriceInput;
  /** New tax entry (creates a new ProductTaxHistory, updates currentTaxHistoryId). */
  newTax?: CreateProductTaxInput;
}

export interface ProductListItem {
  id: string;
  internalCode: string;
  commercialName: string;
  genericName: string;
  activePrinciple: string;
  concentration: string | null;
  concentrationUnit: string | null;
  laboratory: string;
  saleType: SaleType;
  minimumStock: number;
  isActive: boolean;
  invimaRegistry: string | null;
  atcCode: string | null;
  categoryId: string | null;
  pharmaceuticalFormId: string | null;
  createdAt: string;
  updatedAt: string;
  barcodes: Array<{ id: string; barcode: string; barcodeType: string; isPrimary: boolean }>;
  /** Active price as decimal string, or null if no price set. */
  currentPrice: string | null;
}

export interface ProductSearchResult {
  id: string;
  internalCode: string;
  commercialName: string;
  genericName: string;
  activePrinciple: string;
  concentration: string | null;
  laboratory: string;
  saleType: SaleType;
  isActive: boolean;
  currentPrice: string | null;
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
   * Searches across `commercialName`, `genericName`, `activePrinciple`,
   * and `internalCode`. Optionally filters by `isActive`.
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
        { genericName: { contains: q, mode: 'insensitive' } },
        { activePrinciple: { contains: q, mode: 'insensitive' } },
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
          priceHistories: {
            where: { effectiveTo: null },
            select: { price: true },
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
        genericName: p.genericName,
        activePrinciple: p.activePrinciple,
        concentration: p.concentration,
        concentrationUnit: p.concentrationUnit,
        laboratory: p.laboratory,
        saleType: p.saleType as SaleType,
        minimumStock: p.minimumStock,
        isActive: p.isActive,
        invimaRegistry: p.invimaRegistry,
        atcCode: p.atcCode,
        categoryId: p.categoryId,
        pharmaceuticalFormId: p.pharmaceuticalFormId,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        barcodes: p.barcodes,
        currentPrice: p.priceHistories[0]?.price.toString() ?? null,
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
          take: 1,
          include: {
            changedByUser: { select: { id: true, displayName: true } },
          },
        },
        taxHistories: {
          where: { effectiveTo: null },
          take: 1,
          include: {
            taxScheme: { select: { id: true, code: true, name: true, taxType: true, rate: true } },
            changedByUser: { select: { id: true, displayName: true } },
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
          take: 1,
        },
      },
    });

    if (!product) return null;

    return {
      id: product.id,
      internalCode: product.internalCode,
      commercialName: product.commercialName,
      genericName: product.genericName,
      activePrinciple: product.activePrinciple,
      concentration: product.concentration,
      laboratory: product.laboratory,
      saleType: product.saleType as SaleType,
      isActive: product.isActive,
      currentPrice: product.priceHistories[0]?.price.toString() ?? null,
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
          take: 1,
        },
      },
    });

    if (!product) return null;

    return {
      id: product.id,
      internalCode: product.internalCode,
      commercialName: product.commercialName,
      genericName: product.genericName,
      activePrinciple: product.activePrinciple,
      concentration: product.concentration,
      laboratory: product.laboratory,
      saleType: product.saleType as SaleType,
      isActive: product.isActive,
      currentPrice: product.priceHistories[0]?.price.toString() ?? null,
    };
  }

  /**
   * Create a new product locally.
   *
   * Requires INVENTORY_ASSISTANT or ADMIN role.
   *
   * 1. Generates an OFFLINE-{uuid} internalCode for offline-created products.
   * 2. Validates that primary barcode is not a duplicate.
   * 3. Creates the product row with null price/tax pointers.
   * 4. Creates the initial ProductPriceHistory and ProductTaxHistory rows.
   * 5. Updates product with currentPriceId and currentTaxHistoryId.
   * 6. Inserts a SyncQueue row (PRODUCT_CREATION) inside the same transaction.
   *
   * @throws ProductCreationException if barcode is duplicate.
   */
  async createProduct(input: CreateProductInput): Promise<unknown> {
    const session = this.auth.requireRole(
      RoleType.INVENTORY_ASSISTANT,
      RoleType.ADMIN,
    );

    // Pre-validate duplicate barcodes
    const primaryBarcode = input.barcodes.find((b) => b.isPrimary);
    for (const bc of input.barcodes) {
      const existing = await this.prisma.productBarcode.findUnique({
        where: { barcode: bc.barcode },
        select: { id: true },
      });
      if (existing) {
        throw new DuplicateBarcodeException(bc.barcode);
      }
    }

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
          genericName: input.genericName,
          activePrinciple: input.activePrinciple,
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
          categoryId: input.categoryId ?? null,
          pharmaceuticalFormId: input.pharmaceuticalFormId ?? null,
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
          taxSchemeId: input.tax.taxSchemeId,
          effectiveFrom: taxEffectiveFrom,
          changedById: session.userId,
          changedAt: now,
          changeReason: input.tax.changeReason ?? 'Initial tax on creation',
        },
      });

      // 5. Update product with price/tax pointers
      await tx.product.update({
        where: { id: productId },
        data: {
          currentPriceId: priceHistoryId,
          currentTaxHistoryId: taxHistoryId,
        },
      });

      // 6. Build full product data for sync payload
      const syncPayload = {
        operationType: 'PRODUCT_CREATION' as const,
        userId: session.userId,
        createProductDto: {
          internalCode,
          commercialName: input.commercialName,
          genericName: input.genericName,
          activePrinciple: input.activePrinciple,
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
          categoryId: input.categoryId ?? undefined,
          pharmaceuticalFormId: input.pharmaceuticalFormId ?? undefined,
          barcodes: input.barcodes.map((bc) => ({
            barcode: bc.barcode,
            barcodeType: bc.barcodeType,
            isPrimary: bc.isPrimary ?? false,
          })),
          price: {
            price: input.price.price.toString(),
            effectiveFrom: effectiveFrom.toISOString(),
          },
          tax: {
            taxSchemeId: input.tax.taxSchemeId,
            effectiveFrom: taxEffectiveFrom.toISOString(),
          },
        },
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
    });
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
      select: { id: true, currentPriceId: true, currentTaxHistoryId: true },
    });
    if (!existing) throw new ProductNotFoundException(id);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // 1. Update scalar fields
      const updateData: Prisma.ProductUpdateInput = {};

      if (input.commercialName !== undefined) updateData.commercialName = input.commercialName;
      if (input.genericName !== undefined) updateData.genericName = input.genericName;
      if (input.activePrinciple !== undefined) updateData.activePrinciple = input.activePrinciple;
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
      if (input.categoryId !== undefined) updateData.categoryId = input.categoryId;
      if (input.pharmaceuticalFormId !== undefined) updateData.pharmaceuticalFormId = input.pharmaceuticalFormId;

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

      // 4. Handle new tax entry
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
      const syncPayload = {
        operationType: 'PRODUCT_UPDATE' as const,
        userId: session.userId,
        updateProductDto: {
          internalCode: updated.internalCode,
          ...(input.commercialName !== undefined && { commercialName: input.commercialName }),
          ...(input.genericName !== undefined && { genericName: input.genericName }),
          ...(input.activePrinciple !== undefined && { activePrinciple: input.activePrinciple }),
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
          ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
          ...(input.pharmaceuticalFormId !== undefined && { pharmaceuticalFormId: input.pharmaceuticalFormId }),
          ...(input.barcodes && {
            barcodes: input.barcodes.map((bc) => ({
              barcode: bc.barcode,
              barcodeType: bc.barcodeType,
              isPrimary: bc.isPrimary ?? false,
            })),
          }),
          ...(input.newPrice && {
            price: {
              price: input.newPrice.price.toString(),
              effectiveFrom: (input.newPrice.effectiveFrom
                ? new Date(input.newPrice.effectiveFrom)
                : now
              ).toISOString(),
              changeReason: input.newPrice.changeReason ?? null,
            },
          }),
          ...(input.newTax && {
            tax: {
              taxSchemeId: input.newTax.taxSchemeId,
              effectiveFrom: (input.newTax.effectiveFrom
                ? new Date(input.newTax.effectiveFrom)
                : now
              ).toISOString(),
              changeReason: input.newTax.changeReason ?? null,
            },
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
    });
  }

  // -------------------------------------------------------------------------
  // Private — sync helpers
  // -------------------------------------------------------------------------

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
