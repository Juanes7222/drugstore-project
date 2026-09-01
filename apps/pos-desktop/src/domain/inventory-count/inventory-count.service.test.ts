/**
 * Unit tests for InventoryCountService — full physical inventory reconteo.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma } from '@pharmacy/database/local';
import { RoleType } from '@pharmacy/shared-types';
import {
  createInventoryCountService,
  InventoryCountService,
} from './inventory-count.service';
import {
  InventoryCountAlreadyExistsException,
  InventoryCountLineNotFoundException,
  InventoryCountNoLinesException,
  InventoryCountNotFoundException,
  InventoryCountNotReadyToCloseException,
  InventoryCountStateException,
} from './exceptions';

// ---------------------------------------------------------------------------
// Mocks for crypto
// ---------------------------------------------------------------------------
// Stable UUIDs so snapshots/lines are deterministic across tests
let uuidCounter = 0;
vi.spyOn(globalThis.crypto as any, 'randomUUID').mockImplementation(() => {
  uuidCounter += 1;
  return `uuid-${String(uuidCounter).padStart(4, '0')}`;
});

// SHA-256 digest stub for closeSession — returns 32 zero bytes
if (globalThis.crypto.subtle) {
  vi.spyOn(globalThis.crypto.subtle, 'digest').mockResolvedValue(
    new Uint8Array(32).buffer as ArrayBuffer,
  );
} else {
  (globalThis.crypto as any).subtle = {
    digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
  };
}

// Mock notifier so closeSession side-effect is observable
vi.mock('../sync/sync-queue-notifier', () => ({
  notifyPendingEntry: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const makeMockSession = () => ({
  userId: 'user-1',
  username: 'inv1',
  fullName: 'Inventory Assistant',
  displayName: 'Inventory Assistant',
  email: null,
  role: 'INVENTORY_ASSISTANT',
  subscriptionId: null,
  workstationId: 'ws-1',
  accessToken: 'token',
  refreshToken: 'refresh',
  expiresAt: new Date('2099-12-31'),
  sessionId: 'sess-1',
  totpEnabled: false,
  avatarUrl: null,
  avatarColor: null,
  mustChangePassword: false,
});

const makeMockAuth = () => ({
  requireRole: vi.fn().mockReturnValue(makeMockSession()),
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

const makeMockPrisma = () => {
  const tx: any = {
    inventoryCountSession: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    inventoryCountCounter: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    inventoryAdjustmentCounter: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    inventoryCountSnapshot: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    inventoryCountLine: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      createMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    lot: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    productCostHistory: {
      findMany: vi.fn(),
    },
    category: {
      findUnique: vi.fn(),
    },
    inventoryMovement: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    inventoryAdjustmentDocument: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    syncQueue: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    product: {
      findMany: vi.fn(),
    },
  };

  const transaction = vi.fn(async (cb: (t: any) => unknown) => cb(tx));

  const prisma: any = {
    $transaction: transaction,
    inventoryCountSession: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    inventoryCountCounter: tx.inventoryCountCounter,
    inventoryCountSessionTx: tx.inventoryCountSession,
    lot: tx.lot,
    inventoryCountSnapshot: tx.inventoryCountSnapshot,
    inventoryCountLine: tx.inventoryCountLine,
    syncQueue: tx.syncQueue,
  };

  // For non-transactional calls (listSessions etc.), route to prisma.* mocks
  // For transactional calls, the service uses prisma.$transaction which already delegates to tx
  return { prisma, tx, transaction };
};

const baseSessionRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'sess-1',
  code: 'IC-0001',
  sequentialNumber: 1,
  name: null,
  state: 'DRAFT',
  scopeType: 'FULL',
  scopeValue: null,
  scopeLabel: null,
  mode: 'BLIND',
  tolerancePercent: 2,
  requireDoubleCount: true,
  totalLines: 0,
  countedLines: 0,
  recountedLines: 0,
  discrepancyCount: 0,
  totalValueImpact: null,
  notes: null,
  createdByUserId: 'user-1',
  createdByUserName: 'Inventory Assistant',
  workstationId: 'ws-1',
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
  updatedAt: new Date('2026-01-01T10:00:00.000Z'),
  startedAt: null,
  reviewedAt: null,
  closedAt: null,
  cancelledAt: null,
  adjustmentDocumentId: null,
  ...overrides,
});

const baseLineRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'line-1',
  sessionId: 'sess-1',
  snapshotId: 'snap-1',
  productId: 'prod-1',
  lotId: 'lot-1',
  productName: 'Acetaminofén 500mg',
  internalCode: 'ACET-500',
  lotCode: 'L24001',
  locationCode: 'A-1',
  barcode: '7701234567890',
  theoreticalQty: 100,
  unitCost: new Prisma.Decimal(1000),
  countedQty1: null,
  countedQty2: null,
  finalQty: null,
  difference: null,
  valueImpact: null,
  status: 'PENDING',
  requiresRecount: false,
  isHighValue: false,
  notes: null,
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
  updatedAt: new Date('2026-01-01T10:00:00.000Z'),
  countedAt1: null,
  countedAt2: null,
  resolvedAt: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('InventoryCountService', () => {
  let prisma: any;
  let tx: any;
  let auth: ReturnType<typeof makeMockAuth>;
  let service: InventoryCountService;

  beforeEach(() => {
    uuidCounter = 0;
    vi.clearAllMocks();
    // re-apply crypto stubs after clearAllMocks (vi.clearAllMocks resets spies)
    vi.spyOn(globalThis.crypto as any, 'randomUUID').mockImplementation(() => {
      uuidCounter += 1;
      return `uuid-${String(uuidCounter).padStart(4, '0')}`;
    });
    if (globalThis.crypto.subtle) {
      vi.spyOn(globalThis.crypto.subtle, 'digest').mockResolvedValue(
        new Uint8Array(32).buffer as ArrayBuffer,
      );
    }
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    auth = makeMockAuth();
    // restore default requireRole behavior after clear
    auth.requireRole.mockReturnValue(makeMockSession());
    service = createInventoryCountService(prisma, auth as any);
  });

  // ── listSessions ───────────────────────────────────────────────────────
  describe('listSessions', () => {
    it('requires INVENTORY_ASSISTANT or ADMIN role', async () => {
      prisma.inventoryCountSession.findMany.mockResolvedValue([]);

      await service.listSessions();

      expect(auth.requireRole).toHaveBeenCalledWith(
        RoleType.INVENTORY_ASSISTANT,
        RoleType.ADMIN,
      );
    });

    it('returns mapped sessions ordered by createdAt desc', async () => {
      const rows = [baseSessionRow({ id: 's1', code: 'IC-0002' }), baseSessionRow({ id: 's2', code: 'IC-0001' })];
      prisma.inventoryCountSession.findMany.mockResolvedValue(rows);

      const result = await service.listSessions(30);

      expect(result).toHaveLength(2);
      expect(result[0].code).toBe('IC-0002');
      expect(prisma.inventoryCountSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' }, take: 30 }),
      );
    });

    it('defaults limit to 20', async () => {
      prisma.inventoryCountSession.findMany.mockResolvedValue([]);

      await service.listSessions();

      expect(prisma.inventoryCountSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });
  });

  // ── getSession ─────────────────────────────────────────────────────────
  describe('getSession', () => {
    it('returns mapped session when found', async () => {
      prisma.inventoryCountSession.findUnique.mockResolvedValue(baseSessionRow());

      const result = await service.getSession('sess-1');

      expect(result.id).toBe('sess-1');
      expect(result.code).toBe('IC-0001');
    });

    it('throws InventoryCountNotFoundException when not found', async () => {
      prisma.inventoryCountSession.findUnique.mockResolvedValue(null);

      await expect(service.getSession('missing')).rejects.toThrow(
        InventoryCountNotFoundException,
      );
    });
  });

  // ── getActiveSession ───────────────────────────────────────────────────
  describe('getActiveSession', () => {
    it('returns null when no active session exists', async () => {
      prisma.inventoryCountSession.findFirst.mockResolvedValue(null);

      const result = await service.getActiveSession();

      expect(result).toBeNull();
    });

    it('returns mapped active session when found', async () => {
      prisma.inventoryCountSession.findFirst.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS' }),
      );

      const result = await service.getActiveSession();

      expect(result?.state).toBe('IN_PROGRESS');
    });

    it('queries for DRAFT, IN_PROGRESS, IN_REVIEW states', async () => {
      prisma.inventoryCountSession.findFirst.mockResolvedValue(null);

      await service.getActiveSession();

      expect(prisma.inventoryCountSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { state: { in: ['DRAFT', 'IN_PROGRESS', 'IN_REVIEW'] } },
        }),
      );
    });
  });

  // ── createSession ──────────────────────────────────────────────────────
  describe('createSession', () => {
    beforeEach(() => {
      // No active session by default
      prisma.inventoryCountSession.findFirst = vi.fn().mockResolvedValue(null);
      // Counter upsert + fresh read
      tx.inventoryCountCounter.upsert.mockResolvedValue({ lastSequentialNumber: 1 });
      tx.inventoryCountCounter.findUnique.mockResolvedValue({ lastSequentialNumber: 1 });
      prisma.inventoryCountSession.findFirst.mockResolvedValue(null);
      // Need to route prisma.inventoryCountSession.findFirst to tx for the singleton check inside createSession?
      // createSession uses (this.prisma as any).inventoryCountSession.findFirst via prisma, not tx.
      prisma.inventoryCountSession.findFirst.mockResolvedValue(null);
      // Mock prisma-side counter for fresh read — service does prisma.inventoryCountCounter.findUnique for fresh
      // but our prisma object shares the same mock as tx, so tx mock covers it.
      // Mock create to echo the row
      (prisma as any).inventoryCountSession.create = vi.fn().mockImplementation(async ({ data }: any) => ({
        ...baseSessionRow({ ...data }),
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      }));
      // Auth returns valid session
      auth.requireRole.mockReturnValue(makeMockSession());
    });

    it('requires INVENTORY_ASSISTANT or ADMIN role', async () => {
      await service.createSession({});

      expect(auth.requireRole).toHaveBeenCalledWith(
        RoleType.INVENTORY_ASSISTANT,
        RoleType.ADMIN,
      );
    });

    it('throws InventoryCountAlreadyExistsException when an active session exists', async () => {
      prisma.inventoryCountSession.findFirst.mockResolvedValueOnce(
        baseSessionRow({ state: 'IN_PROGRESS' }),
      );

      await expect(service.createSession({})).rejects.toThrow(
        InventoryCountAlreadyExistsException,
      );
    });

    it('creates a DRAFT session with IC-0001 code on first count', async () => {
      tx.inventoryCountCounter.upsert.mockResolvedValue({ lastSequentialNumber: 1 });
      tx.inventoryCountCounter.findUnique.mockResolvedValue({ lastSequentialNumber: 1 });
      // ensure prisma.inventoryCountSession.findFirst returns null for guard
      prisma.inventoryCountSession.findFirst.mockResolvedValue(null);

      const result = await service.createSession({ name: 'Cierre agosto' });

      expect(result.code).toBe('IC-0001');
      expect(result.state).toBe('DRAFT');
      expect(result.name).toBe('Cierre agosto');
    });

    it('pads sequentialNumber to 4 digits', async () => {
      tx.inventoryCountCounter.upsert.mockResolvedValue({ lastSequentialNumber: 42 });
      tx.inventoryCountCounter.findUnique.mockResolvedValue({ lastSequentialNumber: 42 });
      prisma.inventoryCountSession.findFirst.mockResolvedValue(null);

      const result = await service.createSession({});

      expect(result.code).toBe('IC-0042');
      expect(result.sequentialNumber).toBe(42);
    });

    it('applies defaults: FULL scope, BLIND mode, 2% tolerance, requireDoubleCount true', async () => {
      tx.inventoryCountCounter.findUnique.mockResolvedValue({ lastSequentialNumber: 1 });
      prisma.inventoryCountSession.findFirst.mockResolvedValue(null);

      const result = await service.createSession({});

      expect(result.scopeType).toBe('FULL');
      expect(result.mode).toBe('BLIND');
      expect(result.tolerancePercent).toBe(2);
      expect(result.requireDoubleCount).toBe(true);
    });

    it('respects custom scope, mode and tolerance', async () => {
      tx.inventoryCountCounter.findUnique.mockResolvedValue({ lastSequentialNumber: 1 });
      prisma.inventoryCountSession.findFirst.mockResolvedValue(null);

      const result = await service.createSession({
        scopeType: 'CATEGORY' as any,
        scopeValue: 'cat-1',
        scopeLabel: 'Analgésicos',
        mode: 'INFORMED' as any,
        tolerancePercent: 5,
        requireDoubleCount: false,
      });

      expect(result.scopeType).toBe('CATEGORY');
      expect(result.scopeValue).toBe('cat-1');
      expect(result.scopeLabel).toBe('Analgésicos');
      expect(result.mode).toBe('INFORMED');
      expect(result.tolerancePercent).toBe(5);
      expect(result.requireDoubleCount).toBe(false);
    });
  });

  // ── startSession ───────────────────────────────────────────────────────
  describe('startSession', () => {
    it('throws InventoryCountNotFoundException when session does not exist', async () => {
      tx.inventoryCountSession.findUnique.mockResolvedValue(null);

      await expect(service.startSession('missing')).rejects.toThrow(
        InventoryCountNotFoundException,
      );
    });

    it('throws InventoryCountStateException when session is not DRAFT', async () => {
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS' }),
      );

      await expect(service.startSession('sess-1')).rejects.toThrow(
        InventoryCountStateException,
      );
    });

    it('throws InventoryCountNoLinesException when no ACTIVE lots match scope', async () => {
      tx.inventoryCountSession.findUnique.mockResolvedValue(baseSessionRow({ state: 'DRAFT' }));
      tx.lot.findMany.mockResolvedValue([]);
      tx.category.findUnique.mockResolvedValue(null);

      await expect(service.startSession('sess-1')).rejects.toThrow(
        InventoryCountNoLinesException,
      );
    });

    it('creates snapshot + line per lot and transitions to IN_PROGRESS', async () => {
      const now = new Date();
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'DRAFT', scopeType: 'FULL' }),
      );
      tx.lot.findMany.mockResolvedValue([
        {
          id: 'lot-1',
          productId: 'prod-1',
          batchNumber: 'B001',
          currentStock: 100,
          expirationDate: new Date('2027-06-01'),
          locationCode: 'A-1',
          product: {
            id: 'prod-1',
            internalCode: 'ACET-500',
            commercialName: 'Acetaminofén 500mg',
            concentration: null,
            laboratory: 'Genfar',
            categoryId: 'cat-1',
            barcodes: [{ barcode: '7700001' }],
          },
        },
      ]);
      tx.productCostHistory.findMany.mockResolvedValue([
        { productId: 'prod-1', cost: new Prisma.Decimal(1000) },
      ]);
      tx.inventoryCountSnapshot.createMany.mockResolvedValue({ count: 1 });
      tx.inventoryCountLine.createMany.mockResolvedValue({ count: 1 });
      tx.inventoryCountSession.update.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS', totalLines: 1, startedAt: now }),
      );

      const result = await service.startSession('sess-1');

      expect(result.state).toBe('IN_PROGRESS');
      expect(tx.inventoryCountSnapshot.createMany).toHaveBeenCalled();
      expect(tx.inventoryCountLine.createMany).toHaveBeenCalled();
      const linesArg = tx.inventoryCountLine.createMany.mock.calls[0][0].data;
      expect(linesArg).toHaveLength(1);
      expect(linesArg[0].theoreticalQty).toBe(100);
    });

    it('marks high-value lines when cost > 50000', async () => {
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'DRAFT', scopeType: 'FULL' }),
      );
      tx.lot.findMany.mockResolvedValue([
        {
          id: 'lot-hv',
          productId: 'prod-hv',
          batchNumber: 'B-HV',
          currentStock: 2,
          expirationDate: new Date('2027-06-01'),
          locationCode: 'A-9',
          product: {
            id: 'prod-hv',
            internalCode: 'HV-001',
            commercialName: 'HighValue Drug',
            concentration: null,
            laboratory: 'Lab',
            categoryId: null,
            barcodes: [],
          },
        },
      ]);
      tx.productCostHistory.findMany.mockResolvedValue([
        { productId: 'prod-hv', cost: new Prisma.Decimal(60000) },
      ]);
      tx.inventoryCountSnapshot.createMany.mockResolvedValue({ count: 1 });
      tx.inventoryCountLine.createMany.mockResolvedValue({ count: 1 });
      tx.inventoryCountSession.update.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS', totalLines: 1 }),
      );

      await service.startSession('sess-1');

      const linesArg = tx.inventoryCountLine.createMany.mock.calls[0][0].data;
      expect(linesArg[0].isHighValue).toBe(true);
    });

    it('marks high-value when cost*stock > 200k even if unit cost is low', async () => {
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'DRAFT', scopeType: 'FULL' }),
      );
      tx.lot.findMany.mockResolvedValue([
        {
          id: 'lot-hv2',
          productId: 'prod-hv2',
          batchNumber: 'B-HV2',
          currentStock: 500,
          expirationDate: new Date('2027-06-01'),
          locationCode: 'A-9',
          product: {
            id: 'prod-hv2',
            internalCode: 'HV-002',
            commercialName: 'Bulk Drug',
            concentration: null,
            laboratory: 'Lab',
            categoryId: null,
            barcodes: [],
          },
        },
      ]);
      tx.productCostHistory.findMany.mockResolvedValue([
        { productId: 'prod-hv2', cost: new Prisma.Decimal(500) }, // 500*500=250k
      ]);
      tx.inventoryCountSnapshot.createMany.mockResolvedValue({ count: 1 });
      tx.inventoryCountLine.createMany.mockResolvedValue({ count: 1 });
      tx.inventoryCountSession.update.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS', totalLines: 1 }),
      );

      await service.startSession('sess-1');

      const linesArg = tx.inventoryCountLine.createMany.mock.calls[0][0].data;
      expect(linesArg[0].isHighValue).toBe(true);
    });

    it('defaults isHighValue to false for low cost and low stock value', async () => {
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'DRAFT', scopeType: 'FULL' }),
      );
      tx.lot.findMany.mockResolvedValue([
        {
          id: 'lot-low',
          productId: 'prod-low',
          batchNumber: 'B-LOW',
          currentStock: 10,
          expirationDate: new Date('2027-06-01'),
          locationCode: 'A-1',
          product: {
            id: 'prod-low',
            internalCode: 'LOW-001',
            commercialName: 'Low Drug',
            concentration: null,
            laboratory: 'Lab',
            categoryId: null,
            barcodes: [],
          },
        },
      ]);
      tx.productCostHistory.findMany.mockResolvedValue([
        { productId: 'prod-low', cost: new Prisma.Decimal(100) },
      ]);
      tx.inventoryCountSnapshot.createMany.mockResolvedValue({ count: 1 });
      tx.inventoryCountLine.createMany.mockResolvedValue({ count: 1 });
      tx.inventoryCountSession.update.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS', totalLines: 1 }),
      );

      await service.startSession('sess-1');

      const linesArg = tx.inventoryCountLine.createMany.mock.calls[0][0].data;
      expect(linesArg[0].isHighValue).toBe(false);
    });
  });

  // ── listLines ──────────────────────────────────────────────────────────
  describe('listLines', () => {
    it('throws InventoryCountNotFoundException when session missing', async () => {
      prisma.inventoryCountSession.findUnique.mockResolvedValue(null);

      await expect(service.listLines('missing')).rejects.toThrow(
        InventoryCountNotFoundException,
      );
    });

    it('returns paginated lines and total', async () => {
      prisma.inventoryCountSession.findUnique = vi.fn().mockResolvedValue(baseSessionRow());
      // For listLines the service uses this.prisma (not tx) for count+findMany
      // but inside we mocked prisma.inventoryCountSession; need to mock line delegates on prisma via tx? The service uses (this.prisma as any).inventoryCountLine.count/findMany — our prisma object currently has inventoryCountLine via tx? We set prisma.inventoryCountLine = tx.inventoryCountLine? Actually we set prisma object to have no inventoryCountLine, only tx does. Align by adding them.
      (prisma as any).inventoryCountLine = tx.inventoryCountLine;
      tx.inventoryCountLine.count.mockResolvedValue(1);
      tx.inventoryCountLine.findMany.mockResolvedValue([baseLineRow()]);

      const result = await service.listLines('sess-1');

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].productName).toBe('Acetaminofén 500mg');
    });

    it('applies search filter to OR clause', async () => {
      prisma.inventoryCountSession.findUnique = vi.fn().mockResolvedValue(baseSessionRow());
      (prisma as any).inventoryCountLine = tx.inventoryCountLine;
      tx.inventoryCountLine.count.mockResolvedValue(0);
      tx.inventoryCountLine.findMany.mockResolvedValue([]);

      await service.listLines('sess-1', { search: 'ACET' });

      expect(tx.inventoryCountLine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: expect.any(Array) }),
        }),
      );
    });
  });

  // ── getProgress ────────────────────────────────────────────────────────
  describe('getProgress', () => {
    it('throws InventoryCountNotFoundException when session missing', async () => {
      prisma.inventoryCountSession.findUnique = vi.fn().mockResolvedValue(null);

      await expect(service.getProgress('missing')).rejects.toThrow(
        InventoryCountNotFoundException,
      );
    });

    it('computes percent as counted/total*100', async () => {
      prisma.inventoryCountSession.findUnique = vi.fn().mockResolvedValue(baseSessionRow({ totalLines: 10 }));
      (prisma as any).inventoryCountLine = tx.inventoryCountLine;
      tx.inventoryCountLine.count
        .mockResolvedValueOnce(4) // counted
        .mockResolvedValueOnce(1) // recountNeeded
        .mockResolvedValueOnce(1) // recounted
        .mockResolvedValueOnce(2) // resolved
        .mockResolvedValueOnce(3); // discrepancy

      const progress = await service.getProgress('sess-1');

      expect(progress.total).toBe(10);
      expect(progress.counted).toBe(4);
      expect(progress.percent).toBe(40);
      expect(progress.recountNeeded).toBe(1);
    });

    it('returns 0 percent when totalLines is 0', async () => {
      prisma.inventoryCountSession.findUnique = vi.fn().mockResolvedValue(baseSessionRow({ totalLines: 0 }));
      (prisma as any).inventoryCountLine = tx.inventoryCountLine;
      tx.inventoryCountLine.count.mockResolvedValue(0);

      const progress = await service.getProgress('sess-1');

      expect(progress.percent).toBe(0);
    });
  });

  // ── recordCount ────────────────────────────────────────────────────────
  describe('recordCount', () => {
    it('throws InventoryCountNotReadyToCloseException for negative qty', async () => {
      await expect(service.recordCount('line-1', -1)).rejects.toThrow(
        InventoryCountNotReadyToCloseException,
      );
    });

    it('throws for non-integer qty', async () => {
      await expect(service.recordCount('line-1', 1.5)).rejects.toThrow(
        InventoryCountNotReadyToCloseException,
      );
    });

    it('throws InventoryCountLineNotFoundException when line missing', async () => {
      tx.inventoryCountLine.findUnique.mockResolvedValue(null);

      await expect(service.recordCount('missing', 10)).rejects.toThrow(
        InventoryCountLineNotFoundException,
      );
    });

    it('throws InventoryCountStateException when session is not IN_PROGRESS', async () => {
      tx.inventoryCountLine.findUnique.mockResolvedValue(baseLineRow());
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'DRAFT' }),
      );

      await expect(service.recordCount('line-1', 10)).rejects.toThrow(
        InventoryCountStateException,
      );
    });

    it('first count within tolerance → COUNTED, no recount', async () => {
      const line = baseLineRow({
        theoreticalQty: 100,
        countedQty1: null,
        isHighValue: false,
        unitCost: new Prisma.Decimal(10),
      });
      tx.inventoryCountLine.findUnique.mockResolvedValue(line);
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS', tolerancePercent: 2, requireDoubleCount: true }),
      );
      tx.inventoryCountLine.update.mockImplementation(async ({ data }: any) => ({
        ...line,
        ...data,
      }));
      tx.inventoryCountLine.count.mockResolvedValue(0);
      tx.inventoryCountSession.update.mockResolvedValue(baseSessionRow());

      const result = await service.recordCount('line-1', 101); // 1% diff within 2%

      expect(result.status).toBe('COUNTED');
      expect(result.requiresRecount).toBe(false);
      expect(result.difference).toBe(1);
    });

    it('first count outside tolerance → RECOUNT_NEEDED', async () => {
      const line = baseLineRow({
        theoreticalQty: 100,
        countedQty1: null,
        isHighValue: false,
        unitCost: new Prisma.Decimal(10),
      });
      tx.inventoryCountLine.findUnique.mockResolvedValue(line);
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS', tolerancePercent: 2, requireDoubleCount: true }),
      );
      tx.inventoryCountLine.update.mockImplementation(async ({ data }: any) => ({
        ...line,
        ...data,
      }));
      tx.inventoryCountLine.count.mockResolvedValue(0);
      tx.inventoryCountSession.update.mockResolvedValue(baseSessionRow());

      const result = await service.recordCount('line-1', 105); // 5% diff >2%

      expect(result.status).toBe('RECOUNT_NEEDED');
      expect(result.requiresRecount).toBe(true);
    });

    it('high-value always requires recount on any diff even within tolerance', async () => {
      const line = baseLineRow({
        theoreticalQty: 100,
        countedQty1: null,
        isHighValue: true,
        unitCost: new Prisma.Decimal(1000),
      });
      tx.inventoryCountLine.findUnique.mockResolvedValue(line);
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS', tolerancePercent: 2, requireDoubleCount: true }),
      );
      tx.inventoryCountLine.update.mockImplementation(async ({ data }: any) => ({
        ...line,
        ...data,
      }));
      tx.inventoryCountLine.count.mockResolvedValue(0);
      tx.inventoryCountSession.update.mockResolvedValue(baseSessionRow());

      const result = await service.recordCount('line-1', 101);

      expect(result.requiresRecount).toBe(true);
      expect(result.status).toBe('RECOUNT_NEEDED');
    });

    it('high-value with exact match does NOT require recount', async () => {
      const line = baseLineRow({
        theoreticalQty: 100,
        countedQty1: null,
        isHighValue: true,
        unitCost: new Prisma.Decimal(1000),
      });
      tx.inventoryCountLine.findUnique.mockResolvedValue(line);
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS', tolerancePercent: 2, requireDoubleCount: true }),
      );
      tx.inventoryCountLine.update.mockImplementation(async ({ data }: any) => ({
        ...line,
        ...data,
      }));
      tx.inventoryCountLine.count.mockResolvedValue(0);
      tx.inventoryCountSession.update.mockResolvedValue(baseSessionRow());

      const result = await service.recordCount('line-1', 100);

      expect(result.requiresRecount).toBe(false);
      expect(result.status).toBe('COUNTED');
    });

    it('when requireDoubleCount false, never requires recount', async () => {
      const line = baseLineRow({
        theoreticalQty: 100,
        countedQty1: null,
        isHighValue: false,
        unitCost: new Prisma.Decimal(10),
      });
      tx.inventoryCountLine.findUnique.mockResolvedValue(line);
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS', tolerancePercent: 2, requireDoubleCount: false }),
      );
      tx.inventoryCountLine.update.mockImplementation(async ({ data }: any) => ({
        ...line,
        ...data,
      }));
      tx.inventoryCountLine.count.mockResolvedValue(0);
      tx.inventoryCountSession.update.mockResolvedValue(baseSessionRow());

      const result = await service.recordCount('line-1', 120);

      expect(result.requiresRecount).toBe(false);
      expect(result.status).toBe('COUNTED');
    });

    it('theoretical 0 and counted 0 → no recount', async () => {
      const line = baseLineRow({
        theoreticalQty: 0,
        countedQty1: null,
        isHighValue: false,
        unitCost: new Prisma.Decimal(10),
      });
      tx.inventoryCountLine.findUnique.mockResolvedValue(line);
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS', tolerancePercent: 2, requireDoubleCount: true }),
      );
      tx.inventoryCountLine.update.mockImplementation(async ({ data }: any) => ({
        ...line,
        ...data,
      }));
      tx.inventoryCountLine.count.mockResolvedValue(0);
      tx.inventoryCountSession.update.mockResolvedValue(baseSessionRow());

      const result = await service.recordCount('line-1', 0);

      expect(result.requiresRecount).toBe(false);
    });

    it('theoretical 0 and counted non-zero → recount', async () => {
      const line = baseLineRow({
        theoreticalQty: 0,
        countedQty1: null,
        isHighValue: false,
        unitCost: new Prisma.Decimal(10),
      });
      tx.inventoryCountLine.findUnique.mockResolvedValue(line);
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS', tolerancePercent: 2, requireDoubleCount: true }),
      );
      tx.inventoryCountLine.update.mockImplementation(async ({ data }: any) => ({
        ...line,
        ...data,
      }));
      tx.inventoryCountLine.count.mockResolvedValue(0);
      tx.inventoryCountSession.update.mockResolvedValue(baseSessionRow());

      const result = await service.recordCount('line-1', 1);

      expect(result.requiresRecount).toBe(true);
    });

    // Second count branches
    it('second count where c2 equals c1 → RESOLVED', async () => {
      const line = baseLineRow({
        theoreticalQty: 100,
        countedQty1: 95,
        countedQty2: null,
        isHighValue: false,
        unitCost: new Prisma.Decimal(10),
      });
      tx.inventoryCountLine.findUnique.mockResolvedValue(line);
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS', tolerancePercent: 2, requireDoubleCount: true }),
      );
      tx.inventoryCountLine.update.mockImplementation(async ({ data }: any) => ({
        ...line,
        ...data,
      }));
      tx.inventoryCountLine.count.mockResolvedValue(0);
      tx.inventoryCountSession.update.mockResolvedValue(baseSessionRow());

      const result = await service.recordCount('line-1', 95);

      expect(result.status).toBe('RESOLVED');
      expect(result.finalQty).toBe(95);
    });

    it('second count where c2 equals theoretical (and c1 != theoretical) → RESOLVED', async () => {
      const line = baseLineRow({
        theoreticalQty: 100,
        countedQty1: 95,
        countedQty2: null,
        unitCost: new Prisma.Decimal(10),
      });
      tx.inventoryCountLine.findUnique.mockResolvedValue(line);
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS', tolerancePercent: 2, requireDoubleCount: true }),
      );
      tx.inventoryCountLine.update.mockImplementation(async ({ data }: any) => ({
        ...line,
        ...data,
      }));
      tx.inventoryCountLine.count.mockResolvedValue(0);
      tx.inventoryCountSession.update.mockResolvedValue(baseSessionRow());

      const result = await service.recordCount('line-1', 100);

      expect(result.status).toBe('RESOLVED');
      expect(result.finalQty).toBe(100);
    });

    it('second count where c1 equals theoretical but c2 differs → REQUIRES_REVIEW', async () => {
      const line = baseLineRow({
        theoreticalQty: 100,
        countedQty1: 100,
        countedQty2: null,
        unitCost: new Prisma.Decimal(10),
      });
      tx.inventoryCountLine.findUnique.mockResolvedValue(line);
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS', tolerancePercent: 2, requireDoubleCount: true }),
      );
      tx.inventoryCountLine.update.mockImplementation(async ({ data }: any) => ({
        ...line,
        ...data,
      }));
      tx.inventoryCountLine.count.mockResolvedValue(0);
      tx.inventoryCountSession.update.mockResolvedValue(baseSessionRow());

      const result = await service.recordCount('line-1', 98);

      expect(result.status).toBe('REQUIRES_REVIEW');
    });

    it('second count triple mismatch → REQUIRES_REVIEW', async () => {
      const line = baseLineRow({
        theoreticalQty: 100,
        countedQty1: 95,
        countedQty2: null,
        unitCost: new Prisma.Decimal(10),
      });
      tx.inventoryCountLine.findUnique.mockResolvedValue(line);
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS', tolerancePercent: 2, requireDoubleCount: true }),
      );
      tx.inventoryCountLine.update.mockImplementation(async ({ data }: any) => ({
        ...line,
        ...data,
      }));
      tx.inventoryCountLine.count.mockResolvedValue(0);
      tx.inventoryCountSession.update.mockResolvedValue(baseSessionRow());

      const result = await service.recordCount('line-1', 97);

      expect(result.status).toBe('REQUIRES_REVIEW');
      expect(result.finalQty).toBe(97);
    });
  });

  // ── evaluateRecounts ───────────────────────────────────────────────────
  describe('evaluateRecounts', () => {
    it('throws when session not IN_PROGRESS', async () => {
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_REVIEW' }),
      );

      await expect(service.evaluateRecounts('sess-1')).rejects.toThrow(
        InventoryCountStateException,
      );
    });

    it('marks lines outside tolerance and skips already recounted', async () => {
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS', tolerancePercent: 2, requireDoubleCount: true }),
      );
      tx.inventoryCountLine.findMany.mockResolvedValue([
        baseLineRow({ id: 'l1', countedQty1: 105, theoreticalQty: 100, isHighValue: false, requiresRecount: false, status: 'COUNTED', countedQty2: null }),
        baseLineRow({ id: 'l2', countedQty1: 101, theoreticalQty: 100, isHighValue: false, requiresRecount: false, status: 'COUNTED', countedQty2: null }),
        baseLineRow({ id: 'l3', countedQty1: 105, theoreticalQty: 100, isHighValue: false, requiresRecount: false, status: 'COUNTED', countedQty2: 105 }), // already recounted → skip
      ]);
      tx.inventoryCountLine.update.mockResolvedValue(baseLineRow());
      tx.inventoryCountLine.count.mockResolvedValue(0);
      tx.inventoryCountSession.update.mockResolvedValue(baseSessionRow());

      const result = await service.evaluateRecounts('sess-1');

      expect(result.marked).toBe(1);
      expect(tx.inventoryCountLine.update).toHaveBeenCalledTimes(1);
    });
  });

  // ── setFinalQty ────────────────────────────────────────────────────────
  describe('setFinalQty', () => {
    it('throws for negative finalQty', async () => {
      await expect(service.setFinalQty('line-1', -1)).rejects.toThrow(
        InventoryCountNotReadyToCloseException,
      );
    });

    it('throws for non-integer finalQty', async () => {
      await expect(service.setFinalQty('line-1', 1.5)).rejects.toThrow(
        InventoryCountNotReadyToCloseException,
      );
    });

    it('throws when session state is not IN_PROGRESS or IN_REVIEW', async () => {
      tx.inventoryCountLine.findUnique.mockResolvedValue(baseLineRow());
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'CLOSED' }),
      );

      await expect(service.setFinalQty('line-1', 10)).rejects.toThrow(
        InventoryCountStateException,
      );
    });

    it('sets finalQty, difference and RESOLVED status', async () => {
      const line = baseLineRow({ theoreticalQty: 100, unitCost: new Prisma.Decimal(50) });
      tx.inventoryCountLine.findUnique.mockResolvedValue(line);
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_REVIEW' }),
      );
      tx.inventoryCountLine.update.mockImplementation(async ({ data }: any) => ({
        ...line,
        ...data,
      }));
      tx.inventoryCountLine.count.mockResolvedValue(0);
      tx.inventoryCountSession.update.mockResolvedValue(baseSessionRow());

      const result = await service.setFinalQty('line-1', 98);

      expect(result.status).toBe('RESOLVED');
      expect(result.finalQty).toBe(98);
      expect(result.difference).toBe(-2);
      expect(tx.inventoryCountLine.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ finalQty: 98, status: 'RESOLVED' }),
        }),
      );
    });
  });

  // ── moveToReview ───────────────────────────────────────────────────────
  describe('moveToReview', () => {
    it('throws when session not IN_PROGRESS', async () => {
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'DRAFT' }),
      );

      await expect(service.moveToReview('sess-1')).rejects.toThrow(
        InventoryCountStateException,
      );
    });

    it('throws when PENDING lines remain', async () => {
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS' }),
      );
      tx.inventoryCountLine.count.mockResolvedValueOnce(2); // pending
      // second count not reached

      await expect(service.moveToReview('sess-1')).rejects.toThrow(
        InventoryCountNotReadyToCloseException,
      );
    });

    it('throws when RECOUNT_NEEDED lines remain', async () => {
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS' }),
      );
      tx.inventoryCountLine.count
        .mockResolvedValueOnce(0) // pending
        .mockResolvedValueOnce(1); // recountNeeded

      await expect(service.moveToReview('sess-1')).rejects.toThrow(
        InventoryCountNotReadyToCloseException,
      );
    });

    it('auto-resolves COUNTED lines without recount and transitions to IN_REVIEW', async () => {
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS' }),
      );
      tx.inventoryCountLine.count
        .mockResolvedValueOnce(0) // pending
        .mockResolvedValueOnce(0) // recountNeeded
        .mockResolvedValueOnce(3); // blocking final check (0 after auto-resolve)
      tx.inventoryCountLine.findMany.mockResolvedValue([
        baseLineRow({ id: 'l1', status: 'COUNTED', requiresRecount: false }),
        baseLineRow({ id: 'l2', status: 'COUNTED', requiresRecount: false }),
      ]);
      // mock the two auto-resolve updates + final blocking count
      tx.inventoryCountLine.update.mockResolvedValue(baseLineRow({ status: 'RESOLVED' }));
      // After auto-resolve, the blocking check should return 0 — we already mocked the sequence
      // But we need to handle multiple count calls: pending, recountNeeded, then after loop, blocking count
      // Reset and set correct sequence
      tx.inventoryCountLine.count
        .mockReset()
        .mockResolvedValueOnce(0) // pending
        .mockResolvedValueOnce(0) // recountNeeded
        .mockResolvedValueOnce(0); // blocking (after loop)
      tx.inventoryCountSession.update.mockResolvedValue(
        baseSessionRow({ state: 'IN_REVIEW' }),
      );
      // for refreshSessionCounters inside moveToReview? Actually moveToReview calls refreshSessionCounters via tx? It calls this.refreshSessionCounters(tx, sessionId) which uses tx counts
      tx.inventoryCountLine.count.mockResolvedValue(0); // fallback for refresh counters

      await service.moveToReview('sess-1');

      // session updated to IN_REVIEW
      expect(tx.inventoryCountSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ state: 'IN_REVIEW' }) }),
      );
    });
  });

  // ── closeSession ───────────────────────────────────────────────────────
  describe('closeSession', () => {
    it('throws when session not IN_REVIEW', async () => {
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_PROGRESS' }),
      );

      await expect(service.closeSession('sess-1')).rejects.toThrow(
        InventoryCountStateException,
      );
    });

    it('throws when REQUIRES_REVIEW lines miss finalQty', async () => {
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_REVIEW' }),
      );
      tx.inventoryCountLine.count
        .mockResolvedValueOnce(0) // check notIn RESOLVED/REQUIRES_REVIEW (unused)
        .mockResolvedValueOnce(1) // requiresReviewWithoutFinal
        .mockResolvedValueOnce(0); // pendingFinal (not reached if first throws)

      await expect(service.closeSession('sess-1')).rejects.toThrow(
        InventoryCountNotReadyToCloseException,
      );
    });

    it('closes without adjustment when no diffs exist', async () => {
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_REVIEW', code: 'IC-0001', name: null }),
      );
      tx.inventoryCountLine.count
        .mockResolvedValueOnce(0) // requiresReviewWithoutFinal
        .mockResolvedValueOnce(0) // pendingFinal
        ;
      // Need to handle initial unused count — service does: await tx.inventoryCountLine.count({ where: { sessionId, status: { notIn: [...] } } }); but discards
      // So sequence: first count (status notIn) = 0, second = requiresReviewWithoutFinal =0, third = pendingFinal=0
      tx.inventoryCountLine.count.mockReset();
      tx.inventoryCountLine.count
        .mockResolvedValueOnce(0) // status notIn
        .mockResolvedValueOnce(0) // requiresReviewWithoutFinal
        .mockResolvedValueOnce(0); // pendingFinal

      tx.inventoryCountLine.findMany.mockResolvedValue([
        baseLineRow({ difference: 0, valueImpact: new Prisma.Decimal(0) }),
        baseLineRow({ id: 'l2', difference: 0, valueImpact: new Prisma.Decimal(0) }),
      ]);
      tx.inventoryCountSession.update.mockResolvedValue(
        baseSessionRow({ state: 'CLOSED', closedAt: new Date(), discrepancyCount: 0 }),
      );

      const result = await service.closeSession('sess-1');

      expect(result.state).toBe('CLOSED');
      expect(tx.inventoryAdjustmentDocument.create).not.toHaveBeenCalled();
    });

    it('creates InventoryAdjustmentDocument + movements + SyncQueue for diffs', async () => {
      tx.inventoryCountSession.findUnique.mockResolvedValue(
        baseSessionRow({ state: 'IN_REVIEW', code: 'IC-0005', name: 'Test' }),
      );
      tx.inventoryCountLine.count
        .mockReset()
        .mockResolvedValueOnce(0) // status notIn
        .mockResolvedValueOnce(0) // requiresReviewWithoutFinal
        .mockResolvedValueOnce(0); // pendingFinal

      const diffLine = baseLineRow({
        id: 'line-diff',
        productId: 'prod-1',
        lotId: 'lot-1',
        productName: 'Prod 1',
        lotCode: 'B001',
        theoreticalQty: 100,
        difference: 5,
        valueImpact: new Prisma.Decimal(5000),
        unitCost: new Prisma.Decimal(1000),
      });
      tx.inventoryCountLine.findMany
        .mockResolvedValueOnce([diffLine]) // diffs fetch
        .mockResolvedValueOnce([]) // movements fetch for sync payload (empty -> will be mocked second time)
        ;
      // For closeSession, lot application loop will need lot lookup for positive diff
      tx.lot.findUnique.mockResolvedValue({ id: 'lot-1', productId: 'prod-1', currentStock: 100, version: 1, state: 'ACTIVE' });
      tx.lot.updateMany.mockResolvedValue({ count: 1 });
      tx.inventoryMovement.create.mockResolvedValue({});
      tx.inventoryMovement.findMany.mockResolvedValue([
        { lotId: 'lot-1', movementType: 'PHYSICAL_COUNT', quantity: 5, reason: 'Reconteo IC-0005 — +5' },
      ]);
      tx.lot.findMany.mockResolvedValue([
        { id: 'lot-1', batchNumber: 'B001', expirationDate: new Date('2027-06-01'), productId: 'prod-1', currentStock: 105, locationCode: 'A-1' },
      ]);
      tx.inventoryAdjustmentCounter.upsert.mockResolvedValue({ lastSequentialNumber: 1 });
      tx.inventoryAdjustmentCounter.findUnique.mockResolvedValue({ lastSequentialNumber: 1 });
      tx.inventoryAdjustmentDocument.create.mockResolvedValue({
        id: 'adj-1',
        sequentialNumber: 1,
        state: 'APPLIED',
        reason: 'Reconteo IC-0005 — Test',
        notes: 'Cierre reconteo IC-0005',
      });
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});
      tx.inventoryCountSession.update.mockResolvedValue(
        baseSessionRow({ state: 'CLOSED', closedAt: new Date(), adjustmentDocumentId: 'adj-1', discrepancyCount: 1 }),
      );

      const result = await service.closeSession('sess-1');

      expect(result.state).toBe('CLOSED');
      expect(result.adjustmentDocumentId).toBe('adj-1');
      expect(tx.inventoryAdjustmentDocument.create).toHaveBeenCalled();
      expect(tx.inventoryMovement.create).toHaveBeenCalled();
      expect(tx.syncQueue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationType: 'INVENTORY_ADJUSTMENT',
            status: 'PENDING',
          }),
        }),
      );
      const payloadCall = tx.syncQueue.create.mock.calls[0][0];
      const payload = JSON.parse(payloadCall.data.payload);
      expect(payload).toHaveProperty('userId', 'user-1');
      expect(payload).toHaveProperty('createAdjustmentDto');
      expect(payload).toHaveProperty('metadata');
      expect(payload.metadata).toHaveProperty('countSessionId', 'sess-1');
      expect(payload.metadata).toHaveProperty('source', 'PHYSICAL_COUNT');
    });
  });

  // ── cancelSession ──────────────────────────────────────────────────────
  describe('cancelSession', () => {
    it('cancels a DRAFT session', async () => {
      prisma.inventoryCountSession.findUnique = vi.fn().mockResolvedValue(baseSessionRow({ state: 'DRAFT' }));
      prisma.inventoryCountSession.update = vi.fn().mockResolvedValue(
        baseSessionRow({ state: 'CANCELLED', cancelledAt: new Date() }),
      );

      const result = await service.cancelSession('sess-1');

      expect(result.state).toBe('CANCELLED');
    });

    it('throws InventoryCountStateException when already CLOSED', async () => {
      prisma.inventoryCountSession.findUnique = vi.fn().mockResolvedValue(baseSessionRow({ state: 'CLOSED' }));

      await expect(service.cancelSession('sess-1')).rejects.toThrow(
        InventoryCountStateException,
      );
    });

    it('throws InventoryCountStateException when already CANCELLED', async () => {
      prisma.inventoryCountSession.findUnique = vi.fn().mockResolvedValue(baseSessionRow({ state: 'CANCELLED' }));

      await expect(service.cancelSession('sess-1')).rejects.toThrow(
        InventoryCountStateException,
      );
    });

    it('throws InventoryCountNotFoundException when missing', async () => {
      prisma.inventoryCountSession.findUnique = vi.fn().mockResolvedValue(null);

      await expect(service.cancelSession('missing')).rejects.toThrow(
        InventoryCountNotFoundException,
      );
    });
  });

  // ── deleteDraft ────────────────────────────────────────────────────────
  describe('deleteDraft', () => {
    it('deletes a DRAFT session when caller is ADMIN', async () => {
      auth.requireRole.mockReturnValue({ ...makeMockSession(), role: 'ADMIN' });
      prisma.inventoryCountSession.findUnique = vi.fn().mockResolvedValue(baseSessionRow({ state: 'DRAFT' }));
      prisma.inventoryCountSession.delete = vi.fn().mockResolvedValue({});

      await service.deleteDraft('sess-1');

      expect(prisma.inventoryCountSession.delete).toHaveBeenCalledWith({ where: { id: 'sess-1' } });
    });

    it('throws InventoryCountStateException when not DRAFT', async () => {
      auth.requireRole.mockReturnValue({ ...makeMockSession(), role: 'ADMIN' });
      prisma.inventoryCountSession.findUnique = vi.fn().mockResolvedValue(baseSessionRow({ state: 'IN_PROGRESS' }));

      await expect(service.deleteDraft('sess-1')).rejects.toThrow(
        InventoryCountStateException,
      );
    });

    it('requires ADMIN role', async () => {
      prisma.inventoryCountSession.findUnique = vi.fn().mockResolvedValue(baseSessionRow({ state: 'DRAFT' }));

      await service.deleteDraft('sess-1');

      expect(auth.requireRole).toHaveBeenCalledWith(RoleType.ADMIN);
    });
  });
});
