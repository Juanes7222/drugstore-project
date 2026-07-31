/**
 * Unit tests for ProductService — commission validation and sync payloads.
 *
 * Focused on the sales-commission feature: create/update validation, row
 * persistence, ProductListItem exposure, and the reconciliation payload
 * path (enqueueUnsyncedProducts). Uses the same mocked-Prisma test doubles
 * as sales-pos.service.test.ts.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma, SaleType, CommissionType } from "@pharmacy/database/local";
import {
  ProductService,
  createProductService,
  type CreateProductInput,
} from "./product.service";
import { InvalidCommissionException } from "./exceptions";
import { RoleType } from "@pharmacy/shared-types";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const tx: any = {
    product: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    productBarcode: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
    },
    productPriceHistory: { create: vi.fn(), update: vi.fn() },
    productTaxHistory: { create: vi.fn(), update: vi.fn() },
    productCostHistory: { create: vi.fn(), update: vi.fn() },
    syncQueue: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  };

  const transaction = vi.fn(async (cb: (t: any) => unknown) => cb(tx));

  const prisma = {
    $transaction: transaction,
    product: {
      create: tx.product.create,
      update: tx.product.update,
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    productBarcode: {
      findUnique: vi.fn(),
      findFirst: tx.productBarcode.findFirst,
    },
    taxScheme: { findUnique: vi.fn() },
    pharmaceuticalForm: { findUnique: vi.fn() },
    category: { findUnique: vi.fn() },
    syncQueue: {
      create: tx.syncQueue.create,
      findFirst: tx.syncQueue.findFirst,
      findMany: vi.fn(),
    },
  } as any;

  return { prisma, tx };
};

const makeMockAuth = () => ({
  requireRole: vi.fn(),
});

const makeMockSession = () => ({
  userId: "user-1",
  workstationId: "ws-1",
  role: RoleType.INVENTORY_ASSISTANT,
});

const makeCreateProductInput = (
  overrides?: Partial<CreateProductInput>,
): CreateProductInput => ({
  commercialName: "Acetaminofén 500mg",
  laboratory: "Genfar",
  saleType: SaleType.FREE_SALE,
  price: { price: 5000 },
  tax: { taxSchemeId: "tax-iva-19" },
  barcodes: [{ barcode: "7701234567890", barcodeType: "EAN13", isPrimary: true }],
  ...overrides,
});

/** Read the payload JSON written to syncQueue.create on its first call. */
const readFirstSyncPayload = (syncQueueCreate: ReturnType<typeof vi.fn>) => {
  const data = syncQueueCreate.mock.calls[0][0].data;
  return JSON.parse(data.payload) as Record<string, any>;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProductService", () => {
  let prisma: any;
  let tx: any;
  let auth: ReturnType<typeof makeMockAuth>;
  let service: ProductService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    auth = makeMockAuth();
    service = createProductService(prisma, auth as any);
    auth.requireRole.mockReturnValue(makeMockSession());
  });

  // ---------------------------------------------------------------
  // createProduct — commission validation
  // ---------------------------------------------------------------

  describe("createProduct", () => {
    it("throws InvalidCommissionException with reason negative_value when commissionValue is negative", async () => {
      const input = makeCreateProductInput({
        commissionType: CommissionType.PERCENTAGE,
        commissionValue: -5,
      });

      await expect(service.createProduct(input)).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof InvalidCommissionException && err.reason === "negative_value",
      );
    });

    it("throws InvalidCommissionException with reason inverted_window when startsAt is after endsAt", async () => {
      const input = makeCreateProductInput({
        commissionType: CommissionType.PERCENTAGE,
        commissionValue: 5,
        commissionStartsAt: "2026-07-17T00:00:00.000Z",
        commissionEndsAt: "2026-07-16T00:00:00.000Z",
      });

      await expect(service.createProduct(input)).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof InvalidCommissionException && err.reason === "inverted_window",
      );
    });

    it("persists commission fields on the product row", async () => {
      prisma.productBarcode.findUnique.mockResolvedValue(null);
      prisma.taxScheme.findUnique.mockResolvedValue({ id: "tax-iva-19" });
      tx.product.create.mockResolvedValue({ id: "prod-1" });
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      await service.createProduct(
        makeCreateProductInput({
          commissionType: CommissionType.PERCENTAGE,
          commissionValue: 5,
          commissionStartsAt: "2026-07-01T00:00:00.000Z",
          commissionEndsAt: "2026-07-31T00:00:00.000Z",
        }),
      );

      expect(tx.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            commissionType: CommissionType.PERCENTAGE,
            commissionValue: new Prisma.Decimal(5),
            commissionStartsAt: new Date("2026-07-01T00:00:00.000Z"),
            commissionEndsAt: new Date("2026-07-31T00:00:00.000Z"),
          }),
        }),
      );
    });

    it("defaults commission to NONE with value 0 when not provided", async () => {
      prisma.productBarcode.findUnique.mockResolvedValue(null);
      prisma.taxScheme.findUnique.mockResolvedValue({ id: "tax-iva-19" });
      tx.product.create.mockResolvedValue({ id: "prod-1" });
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      await service.createProduct(makeCreateProductInput());

      expect(tx.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            commissionType: CommissionType.NONE,
            commissionValue: new Prisma.Decimal(0),
            commissionStartsAt: null,
            commissionEndsAt: null,
          }),
        }),
      );
    });

    it("includes commission fields in the createProductDto sync payload", async () => {
      prisma.productBarcode.findUnique.mockResolvedValue(null);
      prisma.taxScheme.findUnique.mockResolvedValue({ id: "tax-iva-19" });
      tx.product.create.mockResolvedValue({ id: "prod-1" });
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      await service.createProduct(
        makeCreateProductInput({
          commissionType: CommissionType.FIXED,
          commissionValue: 500,
          commissionStartsAt: "2026-07-01T00:00:00.000Z",
          commissionEndsAt: "2026-07-31T00:00:00.000Z",
        }),
      );

      const payload = readFirstSyncPayload(tx.syncQueue.create);
      expect(payload.createProductDto).toMatchObject({
        commissionType: CommissionType.FIXED,
        commissionValue: "500",
        commissionStartsAt: "2026-07-01T00:00:00.000Z",
        commissionEndsAt: "2026-07-31T00:00:00.000Z",
      });
    });

    it("sends NONE and 0 in the sync payload when commission is not provided", async () => {
      prisma.productBarcode.findUnique.mockResolvedValue(null);
      prisma.taxScheme.findUnique.mockResolvedValue({ id: "tax-iva-19" });
      tx.product.create.mockResolvedValue({ id: "prod-1" });
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      await service.createProduct(makeCreateProductInput());

      const payload = readFirstSyncPayload(tx.syncQueue.create);
      expect(payload.createProductDto).toMatchObject({
        commissionType: CommissionType.NONE,
        commissionValue: "0",
      });
      expect(payload.createProductDto.commissionStartsAt).toBeUndefined();
      expect(payload.createProductDto.commissionEndsAt).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // updateProduct — commission validation and payload
  // ---------------------------------------------------------------

  describe("updateProduct", () => {
    const makeExisting = () => ({
      id: "prod-1",
      currentPriceId: null,
      currentTaxHistoryId: null,
      currentCostId: null,
    });

    it("throws InvalidCommissionException with reason negative_value when commissionValue is negative", async () => {
      prisma.product.findUnique.mockResolvedValue(makeExisting());

      await expect(
        service.updateProduct("prod-1", { commissionValue: -1 }),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof InvalidCommissionException && err.reason === "negative_value",
      );
    });

    it("throws InvalidCommissionException with reason inverted_window when startsAt is after endsAt", async () => {
      prisma.product.findUnique.mockResolvedValue(makeExisting());

      await expect(
        service.updateProduct("prod-1", {
          commissionStartsAt: "2026-07-17T00:00:00.000Z",
          commissionEndsAt: "2026-07-16T00:00:00.000Z",
        }),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof InvalidCommissionException && err.reason === "inverted_window",
      );
    });

    it("persists commission updates as Decimal and Date and includes them in the updateProductDto", async () => {
      prisma.product.findUnique.mockResolvedValue(makeExisting());
      tx.product.update.mockResolvedValue({ id: "prod-1", internalCode: "OFFLINE-1" });
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      await service.updateProduct("prod-1", {
        commissionType: CommissionType.FIXED,
        commissionValue: 500,
        commissionStartsAt: "2026-07-01T00:00:00.000Z",
        commissionEndsAt: "2026-07-31T00:00:00.000Z",
      });

      expect(tx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            commissionType: CommissionType.FIXED,
            commissionValue: new Prisma.Decimal(500),
            commissionStartsAt: new Date("2026-07-01T00:00:00.000Z"),
            commissionEndsAt: new Date("2026-07-31T00:00:00.000Z"),
          }),
        }),
      );

      const payload = readFirstSyncPayload(tx.syncQueue.create);
      expect(payload.updateProductDto).toMatchObject({
        commissionType: CommissionType.FIXED,
        commissionValue: "500",
        commissionStartsAt: "2026-07-01T00:00:00.000Z",
        commissionEndsAt: "2026-07-31T00:00:00.000Z",
      });
    });

    it("sends null window bounds in the payload when the window is cleared", async () => {
      prisma.product.findUnique.mockResolvedValue(makeExisting());
      tx.product.update.mockResolvedValue({ id: "prod-1", internalCode: "OFFLINE-1" });
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      await service.updateProduct("prod-1", {
        commissionValue: 0,
        commissionStartsAt: null,
        commissionEndsAt: null,
      });

      expect(tx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            commissionValue: new Prisma.Decimal(0),
            commissionStartsAt: null,
            commissionEndsAt: null,
          }),
        }),
      );

      const payload = readFirstSyncPayload(tx.syncQueue.create);
      expect(payload.updateProductDto).toMatchObject({
        commissionValue: "0",
        commissionStartsAt: null,
        commissionEndsAt: null,
      });
    });
  });

  // ---------------------------------------------------------------
  // listProducts — commission exposure
  // ---------------------------------------------------------------

  describe("listProducts", () => {
    it("exposes commission configuration on list items", async () => {
      prisma.product.count.mockResolvedValue(1);
      prisma.product.findMany.mockResolvedValue([
        {
          id: "prod-1",
          internalCode: "P001",
          commercialName: "Acetaminofén 500mg",
          concentration: "500mg",
          concentrationUnit: null,
          laboratory: "Genfar",
          saleType: SaleType.FREE_SALE,
          minimumStock: 10,
          isActive: true,
          invimaRegistry: null,
          atcCode: null,
          therapeuticIndication: null,
          storageConditions: null,
          internalNotes: null,
          categoryId: null,
          pharmaceuticalFormId: null,
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
          updatedAt: new Date("2026-07-01T00:00:00.000Z"),
          barcodes: [],
          priceHistories: [],
          costHistories: [],
          taxHistories: [],
          commissionType: CommissionType.PERCENTAGE,
          commissionValue: new Prisma.Decimal(5),
          commissionStartsAt: new Date("2026-07-01T00:00:00.000Z"),
          commissionEndsAt: null,
        },
      ]);

      const result = await service.listProducts();

      expect(result.items[0]).toMatchObject({
        commissionType: CommissionType.PERCENTAGE,
        commissionValue: "5",
        commissionStartsAt: "2026-07-01T00:00:00.000Z",
        commissionEndsAt: null,
      });
    });
  });

  // ---------------------------------------------------------------
  // enqueueUnsyncedProducts — reconciliation payload
  // ---------------------------------------------------------------

  describe("enqueueUnsyncedProducts", () => {
    it("carries commission config through the reconciliation payload", async () => {
      prisma.product.findMany.mockResolvedValue([{ id: "prod-1" }]);
      prisma.syncQueue.findMany.mockResolvedValue([]);
      tx.product.findUnique.mockResolvedValue({
        id: "prod-1",
        serverId: null,
        internalCode: "OFFLINE-1",
        commercialName: "Acetaminofén 500mg",
        concentration: null,
        concentrationUnit: null,
        laboratory: "Genfar",
        saleType: SaleType.FREE_SALE,
        minimumStock: 10,
        invimaRegistry: null,
        atcCode: null,
        therapeuticIndication: null,
        storageConditions: null,
        internalNotes: null,
        categoryId: null,
        pharmaceuticalFormId: null,
        createdById: "user-1",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        commissionType: CommissionType.PERCENTAGE,
        commissionValue: new Prisma.Decimal(5),
        commissionStartsAt: new Date("2026-07-01T00:00:00.000Z"),
        commissionEndsAt: new Date("2026-07-31T00:00:00.000Z"),
        barcodes: [
          { barcode: "7701234567890", barcodeType: "EAN13", isPrimary: true },
        ],
        priceHistories: [{ price: new Prisma.Decimal(5000) }],
        taxHistories: [{ taxSchemeId: "tax-iva-19" }],
        costHistories: [],
      });
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      const result = await service.enqueueUnsyncedProducts();

      expect(result).toEqual({ enqueued: 1 });
      const payload = readFirstSyncPayload(tx.syncQueue.create);
      expect(payload.createProductDto).toMatchObject({
        commissionType: CommissionType.PERCENTAGE,
        commissionValue: "5",
        commissionStartsAt: "2026-07-01T00:00:00.000Z",
        commissionEndsAt: "2026-07-31T00:00:00.000Z",
      });
    });
  });
});
