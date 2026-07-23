/**
 * Unit tests for SuppliersService — CRUD + search/deactivate for suppliers.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createSuppliersService,
  SuppliersService,
  type CreateSupplierInput,
  type UpdateSupplierInput,
} from "./suppliers.service";
import {
  SupplierNotFoundException,
  DuplicateSupplierIdentificationException,
} from "./exceptions";
import { RoleType } from "@pharmacy/shared-types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const tx: any = {
    supplier: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  };

  const transaction = vi.fn(async (cb: (t: any) => unknown) => cb(tx));
  // For listSuppliers which uses `$transaction` as an array overload
  const transactionArray = vi.fn(async (
    queries: any[],
  ) => Promise.all(queries.map((q: any) => q)));

  const prisma = {
    $transaction: transaction,
    supplier: tx.supplier,
  } as any;

  // Support both callable and array overloads
  prisma.$transaction = vi.fn((arg: any) => {
    if (typeof arg === "function") return transaction(arg);
    if (Array.isArray(arg)) return transactionArray(arg);
    return transaction(arg);
  });

  return { prisma, tx };
};

const makeMockAuth = () => ({
  requireRole: vi.fn(),
  getCurrentSession: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  completeTwoFactor: vi.fn(),
  refreshSession: vi.fn(),
  requestStepUp: vi.fn(),
  approveStepUp: vi.fn(),
  verifyStepUp: vi.fn(),
  changePassword: vi.fn(),
  changePin: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  createUser: vi.fn(),
  listUsers: vi.fn(),
  getPendingStepUpRequests: vi.fn(),
  getAuditLogs: vi.fn(),
  disableUser: vi.fn(),
  enableUser: vi.fn(),
  unlockUser: vi.fn(),
  resetUserPin: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
});

const makeMockSession = () => ({
  userId: "user-1",
  username: "inv1",
  fullName: "Inventory Assistant",
  displayName: "Inventory Assistant",
  email: null,
  role: "INVENTORY_ASSISTANT",
  subscriptionId: null,
  workstationId: "ws-1",
  accessToken: "token",
  refreshToken: "refresh",
  expiresAt: new Date("2099-12-31"),
  sessionId: "sess-1",
  totpEnabled: false,
  avatarUrl: null,
  avatarColor: null,
  mustChangePassword: false,
});

const makeSupplierRecord = (overrides?: Partial<any>) => ({
  id: "supplier-1",
  identificationType: "NIT",
  identificationNumber: "900123456-7",
  businessName: "Distribuidora Farmacéutica SAS",
  contactName: "Carlos López",
  phone: "+57 321 456 7890",
  email: "carlos@distribuidora.com",
  address: "Calle 45 # 23-12",
  city: "Bogotá",
  country: "CO",
  isActive: true,
  paymentTermsDays: 30,
  creditLimit: 5000000,
  createdById: "user-1",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SuppliersService", () => {
  let prisma: any;
  let tx: any;
  let auth: ReturnType<typeof makeMockAuth>;
  let service: SuppliersService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    auth = makeMockAuth();
    service = createSuppliersService(prisma, auth as any);
  });

  describe("factory", () => {
    it("creates an instance with all expected methods", () => {
      expect(service).toBeInstanceOf(SuppliersService);
      expect(service.searchSuppliers).toBeInstanceOf(Function);
      expect(service.getSupplier).toBeInstanceOf(Function);
      expect(service.listSuppliers).toBeInstanceOf(Function);
      expect(service.createSupplier).toBeInstanceOf(Function);
      expect(service.updateSupplier).toBeInstanceOf(Function);
      expect(service.deactivateSupplier).toBeInstanceOf(Function);
    });
  });

  describe("searchSuppliers", () => {
    it("returns all active suppliers when query is empty", async () => {
      tx.supplier.findMany.mockResolvedValue([makeSupplierRecord()]);

      const results = await service.searchSuppliers("");

      expect(tx.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
          orderBy: { businessName: "asc" },
        }),
      );
      expect(results).toHaveLength(1);
      expect(results[0].businessName).toBe("Distribuidora Farmacéutica SAS");
    });

    it("returns all active suppliers when query is only whitespace", async () => {
      tx.supplier.findMany.mockResolvedValue([makeSupplierRecord()]);

      const results = await service.searchSuppliers("   ");

      expect(results).toHaveLength(1);
    });

    it("searches by business name with case-insensitive contains", async () => {
      tx.supplier.findMany.mockResolvedValue([makeSupplierRecord()]);

      const results = await service.searchSuppliers("Distribuidora");

      expect(tx.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ businessName: expect.objectContaining({ contains: "distribuidora" }) }),
            ]),
          }),
        }),
      );
      expect(results).toHaveLength(1);
    });

    it("returns empty array when no suppliers match", async () => {
      tx.supplier.findMany.mockResolvedValue([]);

      const results = await service.searchSuppliers("NonExistent");

      expect(results).toEqual([]);
    });
  });

  describe("getSupplier", () => {
    it("returns supplier when found", async () => {
      tx.supplier.findUnique.mockResolvedValue(makeSupplierRecord());

      const result = await service.getSupplier("supplier-1");

      expect(tx.supplier.findUnique).toHaveBeenCalledWith({
        where: { id: "supplier-1" },
      });
      expect(result.id).toBe("supplier-1");
    });

    it("throws SupplierNotFoundException when supplier does not exist", async () => {
      tx.supplier.findUnique.mockResolvedValue(null);

      await expect(service.getSupplier("nonexistent")).rejects.toThrow(
        SupplierNotFoundException,
      );
    });
  });

  describe("listSuppliers", () => {
    it("returns paginated supplier list", async () => {
      tx.supplier.findMany.mockResolvedValue([makeSupplierRecord()]);
      tx.supplier.count.mockResolvedValue(1);

      const result = await service.listSuppliers({ page: 1, pageSize: 50 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });

    it("filters by isActive when provided", async () => {
      tx.supplier.findMany.mockResolvedValue([makeSupplierRecord()]);
      tx.supplier.count.mockResolvedValue(1);

      await service.listSuppliers({ isActive: true });

      expect(tx.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
        }),
      );
    });

    it("filters by search query", async () => {
      tx.supplier.findMany.mockResolvedValue([]);
      tx.supplier.count.mockResolvedValue(0);

      await service.listSuppliers({ search: "Distribuidora" });

      expect(tx.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ businessName: { contains: "Distribuidora", mode: "insensitive" } }),
            ]),
          }),
        }),
      );
    });
  });

  describe("createSupplier", () => {
    const validInput: CreateSupplierInput = {
      identificationType: "NIT" as any,
      identificationNumber: "900123456-7",
      businessName: "Distribuidora Farmacéutica SAS",
      contactName: "Carlos López",
      phone: "+57 321 456 7890",
      email: "carlos@distribuidora.com",
      address: "Calle 45 # 23-12",
      city: "Bogotá",
      country: "CO",
      paymentTermsDays: 30,
      creditLimit: 5000000,
    };

    it("creates a new supplier successfully", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findFirst.mockResolvedValue(null);
      tx.supplier.create.mockResolvedValue(makeSupplierRecord());

      const result = await service.createSupplier(validInput);

      expect(result.businessName).toBe("Distribuidora Farmacéutica SAS");
      expect(auth.requireRole).toHaveBeenCalledWith(
        "INVENTORY_ASSISTANT",
        "ADMIN",
      );
    });

    it("throws DuplicateSupplierIdentificationException when duplicate exists", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findFirst.mockResolvedValue(makeSupplierRecord());

      await expect(service.createSupplier(validInput)).rejects.toThrow(
        DuplicateSupplierIdentificationException,
      );
    });

    it("throws AuthException when role is unauthorized", async () => {
      auth.requireRole.mockImplementation(() => {
        throw new Error("INSUFFICIENT_ROLE");
      });

      await expect(service.createSupplier(validInput)).rejects.toThrow(
        "INSUFFICIENT_ROLE",
      );
    });
  });

  describe("updateSupplier", () => {
    const validInput: UpdateSupplierInput = {
      businessName: "Distribuidora Farmacéutica Actualizada SAS",
    };

    it("updates a supplier successfully", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(makeSupplierRecord());
      tx.supplier.update.mockResolvedValue(
        makeSupplierRecord({ businessName: "Distribuidora Farmacéutica Actualizada SAS" }),
      );

      const result = await service.updateSupplier("supplier-1", validInput);

      expect(result.businessName).toBe("Distribuidora Farmacéutica Actualizada SAS");
    });

    it("throws SupplierNotFoundException when supplier does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSupplier("nonexistent", validInput),
      ).rejects.toThrow(SupplierNotFoundException);
    });

    it("checks for duplicate identification when identificationType changes", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(makeSupplierRecord());
      tx.supplier.findFirst.mockResolvedValue(makeSupplierRecord({ id: "other-supplier" }));

      await expect(
        service.updateSupplier("supplier-1", {
          identificationType: "CC" as any,
          identificationNumber: "123456789",
        }),
      ).rejects.toThrow(DuplicateSupplierIdentificationException);
    });

    it("throws AuthException when role is unauthorized", async () => {
      auth.requireRole.mockImplementation(() => {
        throw new Error("INSUFFICIENT_ROLE");
      });

      await expect(
        service.updateSupplier("supplier-1", validInput),
      ).rejects.toThrow("INSUFFICIENT_ROLE");
    });
  });

  describe("deactivateSupplier", () => {
    it("deactivates a supplier successfully", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(makeSupplierRecord());
      tx.supplier.update.mockResolvedValue(
        makeSupplierRecord({ isActive: false }),
      );

      await service.deactivateSupplier("supplier-1");

      expect(tx.supplier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "supplier-1" },
          data: { isActive: false },
        }),
      );
    });

    it("throws SupplierNotFoundException when supplier does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(null);

      await expect(
        service.deactivateSupplier("nonexistent"),
      ).rejects.toThrow(SupplierNotFoundException);
    });

    it("requires ADMIN role (not INVENTORY_ASSISTANT)", async () => {
      auth.requireRole.mockImplementation(() => {
        throw new Error("INSUFFICIENT_ROLE");
      });

      await expect(
        service.deactivateSupplier("supplier-1"),
      ).rejects.toThrow("INSUFFICIENT_ROLE");

      expect(auth.requireRole).toHaveBeenCalledWith("ADMIN");
    });
  });
});
