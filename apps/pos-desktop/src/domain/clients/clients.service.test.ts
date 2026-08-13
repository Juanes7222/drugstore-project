/**
 * Unit tests for ClientsService — search and offline-first client creation.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ClientsService, createClientsService, type CreateClientInput } from "./clients.service";
import { useLocalConfigStore } from "../configuration/local-config.store";


// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const tx: any = {
    client: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    syncQueue: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  };

  const transaction = vi.fn(async (cb: (t: any) => unknown) => cb(tx));

  const prisma = {
    $transaction: transaction,
    client: tx.client,
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

const makeClient = (overrides: any = {}) => ({
  id: "client-1",
  fullName: "Juan Pérez",
  identificationType: "CC",
  identificationNumber: "12345678",
  email: "juan@example.com",
  phone: "3001234567",
  address: "Calle 123",
  municipality: "Bogotá",
  department: "Cundinamarca",
  classificationId: null,
  isActive: true,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-07-10"),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClientsService", () => {
  let prisma: any;
  let tx: any;
  let auth: ReturnType<typeof makeMockAuth>;
  let service: ClientsService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    auth = makeMockAuth();
    service = createClientsService(prisma, auth as any);

    // Neutral credit policy: disabled with no default limit.
    useLocalConfigStore.setState((s) => ({
      salesConfig: {
        ...s.salesConfig,
        creditEnabled: false,
        defaultCreditLimitCents: 0,
      },
    }));
  });

  describe("search", () => {
    it("returns up to 50 recently updated clients when query is empty", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.client.findMany.mockResolvedValue([makeClient()]);

      const result = await service.search();

      expect(result).toHaveLength(1);
      expect(tx.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { updatedAt: "desc" },
          take: 50,
        }),
      );
    });

    it("searches by identificationNumber when query is a number", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.client.findMany.mockResolvedValue([makeClient()]);

      const result = await service.search("12345678");

      expect(result).toHaveLength(1);
      expect(tx.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            identificationNumber: { startsWith: "12345678" },
            isActive: true,
          }),
        }),
      );
    });

    it("searches by fullName (case-insensitive) when query is text", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.client.findMany.mockResolvedValue([makeClient()]);

      const result = await service.search("Juan");

      expect(result).toHaveLength(1);
      expect(tx.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            fullName: { contains: "Juan", mode: "insensitive" },
          }),
        }),
      );
    });

    it("returns an empty array when no clients match", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.client.findMany.mockResolvedValue([]);

      const result = await service.search("XyzNotFound");

      expect(result).toEqual([]);
    });

    it("requires CASHIER or ADMIN role", async () => {
      auth.requireRole.mockImplementation(() => {
        throw new Error("Unauthorized");
      });

      await expect(service.search("test")).rejects.toThrow("Unauthorized");
    });
  });

  describe("create", () => {
    const validInput: CreateClientInput = {
      fullName: "María García",
      identificationType: "CC",
      identificationNumber: "87654321",
      email: "maria@example.com",
      phone: "3109876543",
    };

    it("creates a client and enqueues a CLIENT_CREATION sync entry", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.client.create.mockResolvedValue(makeClient({
        id: "client-2",
        fullName: "María García",
        identificationNumber: "87654321",
      }));
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      await service.create(validInput);

      expect(auth.requireRole).toHaveBeenCalledWith("CASHIER", "ADMIN");
      expect(tx.client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fullName: "María García",
            identificationNumber: "87654321",
          }),
        }),
      );
      expect(tx.syncQueue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationType: "CLIENT_CREATION",
            status: "PENDING",
          }),
        }),
      );
    });

    it("sets optional fields to null when omitted", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.client.create.mockResolvedValue(makeClient({
        fullName: "Solo Nombre",
        identificationNumber: "00000000",
        email: null,
        phone: null,
      }));
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      const minimalInput: CreateClientInput = {
        fullName: "Solo Nombre",
        identificationType: "CC",
        identificationNumber: "00000000",
      };

      await service.create(minimalInput);

      expect(tx.client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: null,
            phone: null,
          }),
        }),
      );
    });

    it("applies the default credit limit when credit is enabled and none is provided", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      useLocalConfigStore.getState().updateSalesConfig({
        creditEnabled: true,
        defaultCreditLimitCents: 50_000_000, // $500.000 COP
      });
      tx.client.create.mockResolvedValue(makeClient());
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      await service.create(validInput);

      const createCall = tx.client.create.mock.calls[0][0];
      expect(createCall.data.creditLimit.toString()).toBe("500000");
    });

    it("does not apply a default credit limit when credit is disabled", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.client.create.mockResolvedValue(makeClient());
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      await service.create(validInput);

      const createCall = tx.client.create.mock.calls[0][0];
      expect(createCall.data.creditLimit).toBeNull();
    });
  });

  describe("applyDefaultCreditToClients", () => {
    it("requires ADMIN role", async () => {
      auth.requireRole.mockImplementation(() => {
        throw new Error("Unauthorized");
      });

      await expect(service.applyDefaultCreditToClients()).rejects.toThrow(
        "Unauthorized",
      );
    });

    it("no-ops when credit is disabled", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());

      const applied = await service.applyDefaultCreditToClients();

      expect(applied).toBe(0);
      expect(tx.client.findMany).not.toHaveBeenCalled();
    });

    it("no-ops when every client already has a limit", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      useLocalConfigStore.getState().updateSalesConfig({
        creditEnabled: true,
        defaultCreditLimitCents: 50_000_000,
      });
      tx.client.findMany.mockResolvedValue([]);

      const applied = await service.applyDefaultCreditToClients();

      expect(applied).toBe(0);
      expect(tx.client.update).not.toHaveBeenCalled();
    });

    it("applies the default limit to clients without one and enqueues a CLIENT_UPDATE per client", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      useLocalConfigStore.getState().updateSalesConfig({
        creditEnabled: true,
        defaultCreditLimitCents: 50_000_000,
      });
      tx.client.findMany.mockResolvedValue([{ id: "client-1" }, { id: "client-2" }]);
      tx.client.update.mockResolvedValue({});
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      const applied = await service.applyDefaultCreditToClients();

      expect(applied).toBe(2);
      expect(tx.client.findMany).toHaveBeenCalledWith({
        where: { creditLimit: null, isActive: true },
        select: { id: true },
      });

      const firstUpdate = tx.client.update.mock.calls[0][0];
      expect(firstUpdate.where.id).toBe("client-1");
      expect(firstUpdate.data.creditLimit.toString()).toBe("500000");
      expect(firstUpdate.data.updatedById).toBe("user-1");

      // Each updated client gets a CLIENT_UPDATE entry for the server.
      const firstSync = tx.syncQueue.create.mock.calls[0][0];
      expect(firstSync.data.operationType).toBe("CLIENT_UPDATE");
      expect(firstSync.data.status).toBe("PENDING");
      expect(firstSync.data.payload).toContain('"creditLimit":500000');
      expect(firstSync.data.payload).toContain('"localClientId":"client-1"');
      expect(tx.syncQueue.create).toHaveBeenCalledTimes(2);
    });
  });
});
