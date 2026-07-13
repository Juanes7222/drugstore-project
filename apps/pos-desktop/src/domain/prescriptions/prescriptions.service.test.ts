/**
 * Unit tests for PrescriptionsService — prescription registration.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PrescriptionsService, createPrescriptionsService, type CreatePrescriptionInput } from "./prescriptions.service";
import { PrescriptionSaleItemNotFoundException, PrescriptionAlreadyExistsException, ControlledSubstanceFieldsRequiredException } from "./exceptions";
import { RoleType } from "@pharmacy/shared-types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const tx: any = {
    saleItem: { findUnique: vi.fn(), update: vi.fn() },
    prescription: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    syncQueue: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  };

  const transaction = vi.fn(async (cb: (t: any) => unknown) => cb(tx));

  const prisma = {
    $transaction: transaction,
    saleItem: tx.saleItem,
    prescription: tx.prescription,
    syncQueue: tx.syncQueue,
  } as any;

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
});

const makeMockSession = () => ({
  userId: "user-1",
  username: "cajero1",
  fullName: "Cajero Uno",
  displayName: "Cajero Uno",
  email: null,
  role: "CASHIER",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PrescriptionsService", () => {
  let prisma: any;
  let tx: any;
  let auth: ReturnType<typeof makeMockAuth>;
  let service: PrescriptionsService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    auth = makeMockAuth();
    service = createPrescriptionsService(prisma, auth as any);
  });

  const baseInput: CreatePrescriptionInput = {
    saleItemId: "item-1",
    prescriberName: "Dr. García",
    prescriberIdNumber: "12345",
    prescriptionNumber: "RX-001",
  };

  describe("create", () => {
    it("creates a prescription for a valid sale item", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.saleItem.findUnique.mockResolvedValue({ id: "item-1", productId: "prod-1" });
      tx.prescription.findUnique.mockResolvedValue(null);
      tx.prescription.create.mockResolvedValue({
        id: "presc-1",
        saleItemId: "item-1",
        prescriptionNumber: "RX-001",
        createdAt: new Date(),
      });
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      const result = await service.create(baseInput);

      expect(auth.requireRole).toHaveBeenCalledWith("CASHIER", "ADMIN");
      expect(result.saleItemId).toBe("item-1");
      expect(tx.prescription.create).toHaveBeenCalled();
      expect(tx.syncQueue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationType: "PRESCRIPTION_REGISTRATION",
            status: "PENDING",
          }),
        }),
      );
    });

    it("throws PrescriptionSaleItemNotFoundException when sale item does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.saleItem.findUnique.mockResolvedValue(null);

      await expect(
        service.create(baseInput),
      ).rejects.toThrow(PrescriptionSaleItemNotFoundException);
    });

    it("throws PrescriptionAlreadyExistsException when sale item already has a prescription", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.saleItem.findUnique.mockResolvedValue({ id: "item-1" });
      tx.prescription.findUnique.mockResolvedValue({ id: "existing-presc" });

      await expect(
        service.create(baseInput),
      ).rejects.toThrow(PrescriptionAlreadyExistsException);
    });

    it("validates controlled substance mandatory fields", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.saleItem.findUnique.mockResolvedValue({ id: "item-1", productId: "prod-1" });
      tx.prescription.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          ...baseInput,
          isControlledSubstance: true,
        }),
      ).rejects.toThrow(ControlledSubstanceFieldsRequiredException);
    });

    it("accepts full controlled substance data", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.saleItem.findUnique.mockResolvedValue({ id: "item-1" });
      tx.prescription.findUnique.mockResolvedValue(null);
      tx.prescription.create.mockResolvedValue({
        id: "presc-2",
        saleItemId: "item-1",
        isControlledSubstance: true,
        createdAt: new Date(),
      });
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      const result = await service.create({
        ...baseInput,
        isControlledSubstance: true,
        controlledSubstanceBookEntry: "Libro A",
        controlledSubstanceBookPage: "42",
      });

      expect(result.isControlledSubstance).toBe(true);
    });
  });
});
