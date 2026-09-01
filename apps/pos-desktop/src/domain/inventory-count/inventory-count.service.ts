/**
 * InventoryCountService — full physical inventory reconteo.
 *
 * Offline-first, snapshot-isolated. Covers:
 *  - creation (DRAFT)
 *  - start (snapshot + lines) → IN_PROGRESS
 *  - counting (c1 / c2) with blind / informed mode support
 *  - intelligent recount detection (tolerance + high-value flag)
 *  - review → close → stock application + sync queue
 *  - cancel
 *
 * All writes are local PGlite transactions. Close generates a single
 * INVENTORY_ADJUSTMENT sync entry so the server replays the same lot
 * mutations authoritatively.
 */
import {
  PrismaClient,
  Prisma,
  InventoryCountState,
  InventoryCountLineStatus,
  InventoryCountScopeType,
  InventoryCountMode,
  AdjustmentState,
  LotState,
  MovementType,
} from '@pharmacy/database/local';
import type { AuthService } from '../auth/auth.service';
import { RoleType } from '@pharmacy/shared-types';
import { notifyPendingEntry } from '../sync/sync-queue-notifier';
import {
  InventoryCountNotFoundException,
  InventoryCountStateException,
  InventoryCountLineNotFoundException,
  InventoryCountAlreadyExistsException,
  InventoryCountNoLinesException,
  InventoryCountNotReadyToCloseException,
} from './exceptions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateCountInput = {
  name?: string;
  scopeType?: InventoryCountScopeType;
  /** categoryId when scopeType=CATEGORY, laboratory string when LABORATORY */
  scopeValue?: string | null;
  scopeLabel?: string | null;
  mode?: InventoryCountMode;
  tolerancePercent?: number;
  requireDoubleCount?: boolean;
  notes?: string | null;
};

export type CountSessionDto = {
  id: string;
  code: string;
  sequentialNumber: number;
  name: string | null;
  state: InventoryCountState;
  scopeType: InventoryCountScopeType;
  scopeValue: string | null;
  scopeLabel: string | null;
  mode: InventoryCountMode;
  tolerancePercent: number;
  requireDoubleCount: boolean;
  totalLines: number;
  countedLines: number;
  recountedLines: number;
  discrepancyCount: number;
  totalValueImpact: string | null;
  notes: string | null;
  createdByUserId: string;
  createdByUserName: string | null;
  workstationId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  reviewedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  adjustmentDocumentId: string | null;
};

export type CountLineDto = {
  id: string;
  sessionId: string;
  productId: string;
  lotId: string | null;
  productName: string;
  internalCode: string | null;
  lotCode: string | null;
  locationCode: string | null;
  barcode: string | null;
  theoreticalQty: number;
  unitCost: string;
  countedQty1: number | null;
  countedQty2: number | null;
  finalQty: number | null;
  difference: number | null;
  valueImpact: string | null;
  status: InventoryCountLineStatus;
  requiresRecount: boolean;
  isHighValue: boolean;
  notes: string | null;
};

export type CountProgress = {
  total: number;
  counted: number;
  recountNeeded: number;
  recounted: number;
  resolved: number;
  discrepancy: number;
  percent: number;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createInventoryCountService = (
  prisma: PrismaClient,
  auth: AuthService,
): InventoryCountService => new InventoryCountService(prisma, auth);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class InventoryCountService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
  ) {}

  // ── Sessions ──────────────────────────────────────────────────────────

  async listSessions(limit = 20): Promise<CountSessionDto[]> {
    this.auth.requireRole(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN);
    const rows = await (this.prisma as any).inventoryCountSession.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(mapSession);
  }

  async getSession(id: string): Promise<CountSessionDto> {
    this.auth.requireRole(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN);
    const row = await (this.prisma as any).inventoryCountSession.findUnique({ where: { id } });
    if (!row) throw new InventoryCountNotFoundException(id);
    return mapSession(row);
  }

  async getActiveSession(): Promise<CountSessionDto | null> {
    this.auth.requireRole(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN);
    const row = await (this.prisma as any).inventoryCountSession.findFirst({
      where: { state: { in: [InventoryCountState.DRAFT, InventoryCountState.IN_PROGRESS, InventoryCountState.IN_REVIEW] } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? mapSession(row) : null;
  }

  async createSession(input: CreateCountInput): Promise<CountSessionDto> {
    const session = this.auth.requireRole(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN);

    // Only one active count at a time
    const active = await (this.prisma as any).inventoryCountSession.findFirst({
      where: { state: { in: [InventoryCountState.DRAFT, InventoryCountState.IN_PROGRESS, InventoryCountState.IN_REVIEW] } },
    });
    if (active) throw new InventoryCountAlreadyExistsException();

    const id = globalThis.crypto.randomUUID();
    const now = new Date();

    // Atomic sequentialNumber via counter singleton
    const counter = await (this.prisma as any).inventoryCountCounter.upsert({
      where: { id: 'singleton' },
      update: { lastSequentialNumber: { increment: 1 } },
      create: { id: 'singleton', lastSequentialNumber: 1 },
    });
    // If we just incremented, read the new value; if we just created with 1, that's correct.
    // However upsert increment on non-existing creates with 1 then increments? To avoid off-by-one,
    // fetch after upsert.
    const fresh = await (this.prisma as any).inventoryCountCounter.findUnique({ where: { id: 'singleton' } });
    const seq: number = fresh?.lastSequentialNumber ?? counter.lastSequentialNumber;
    // On first create, seq is 1. On increment, fresh holds incremented. Adjust when upsert did increment+create race:
    // Safer: just use fresh.
    const sequentialNumber = seq;
    const code = `IC-${String(sequentialNumber).padStart(4, '0')}`;

    // Resolve defaults — most comfortable for operator
    const scopeType = input.scopeType ?? InventoryCountScopeType.FULL;
    const mode = input.mode ?? InventoryCountMode.BLIND;
    const tolerancePercent = input.tolerancePercent ?? 2.0;
    const requireDoubleCount = input.requireDoubleCount ?? true;

    const created = await (this.prisma as any).inventoryCountSession.create({
      data: {
        id,
        code,
        sequentialNumber,
        name: input.name?.trim() || null,
        state: InventoryCountState.DRAFT,
        scopeType,
        scopeValue: input.scopeValue ?? null,
        scopeLabel: input.scopeLabel ?? null,
        mode,
        tolerancePercent,
        requireDoubleCount,
        totalLines: 0,
        countedLines: 0,
        recountedLines: 0,
        discrepancyCount: 0,
        notes: input.notes ?? null,
        createdByUserId: session.userId,
        createdByUserName: (session as any).fullName ?? (session as any).displayName ?? null,
        workstationId: session.workstationId,
        createdAt: now,
        updatedAt: now,
      },
    });
    return mapSession(created);
  }

  /**
   * Start a DRAFT session — takes a frozen snapshot of current ACTIVE lots
   * (filtered by scope) and materializes one line per lot.
   *
   * Snapshot is immutable audit truth; lines are mutable counting state.
   */
  async startSession(sessionId: string): Promise<CountSessionDto> {
    this.auth.requireRole(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN);

    return (this.prisma as any).$transaction(async (tx: any) => {
      const s = await tx.inventoryCountSession.findUnique({ where: { id: sessionId } });
      if (!s) throw new InventoryCountNotFoundException(sessionId);
      if (s.state !== InventoryCountState.DRAFT) throw new InventoryCountStateException(sessionId, s.state, InventoryCountState.DRAFT);

      // Build lot filter according to scope
      const lotWhere: any = { state: LotState.ACTIVE };
      let scopeLabel = s.scopeLabel;
      if (s.scopeType === InventoryCountScopeType.CATEGORY && s.scopeValue) {
        // Filter lots whose product.categoryId matches
        lotWhere.product = { categoryId: s.scopeValue };
        if (!scopeLabel) {
          const cat = await tx.category.findUnique({ where: { id: s.scopeValue }, select: { name: true } });
          scopeLabel = cat?.name ?? s.scopeValue;
        }
      } else if (s.scopeType === InventoryCountScopeType.LABORATORY && s.scopeValue) {
        lotWhere.product = { laboratory: s.scopeValue };
        scopeLabel = scopeLabel ?? s.scopeValue;
      }

      const lots = await tx.lot.findMany({
        where: lotWhere,
        include: {
          product: {
            select: {
              id: true,
              internalCode: true,
              commercialName: true,
              concentration: true,
              laboratory: true,
              categoryId: true,
              barcodes: { where: { isPrimary: true }, select: { barcode: true }, take: 1 },
            },
          },
        },
        orderBy: [{ product: { commercialName: 'asc' } }, { expirationDate: 'asc' }],
      });

      if (lots.length === 0) throw new InventoryCountNoLinesException();

      // Fetch costs batch — latest active cost per product
      const productIds = [...new Set(lots.map((l: any) => l.productId))];
      const costRows: any[] = await tx.productCostHistory.findMany({
        where: { productId: { in: productIds }, effectiveTo: null },
        select: { productId: true, cost: true },
      });
      const costMap = new Map<string, Prisma.Decimal>(costRows.map((r: any) => [r.productId, r.cost]));

      // High-value threshold: top 10% by cost*stock, but simple fixed: cost > 50000 COP or theoreticalQty*cost > 200k
      const HIGH_COST = new Prisma.Decimal(50000);
      const HIGH_VALUE_TOTAL = new Prisma.Decimal(200000);

      const now = new Date();
      const snapshotsData: any[] = [];
      const linesData: any[] = [];

      for (const lot of lots) {
        const cost: Prisma.Decimal = costMap.get(lot.productId) ?? new Prisma.Decimal(0);
        const isHighValue = cost.greaterThan(HIGH_COST) || cost.mul(lot.currentStock).greaterThan(HIGH_VALUE_TOTAL);
        const snapshotId = globalThis.crypto.randomUUID();
        const lineId = globalThis.crypto.randomUUID();

        snapshotsData.push({
          id: snapshotId,
          sessionId,
          productId: lot.productId,
          lotId: lot.id,
          productName: lot.product.commercialName,
          internalCode: lot.product.internalCode,
          lotCode: lot.batchNumber,
          locationCode: lot.locationCode ?? null,
          theoreticalQty: lot.currentStock,
          unitCost: cost,
          expirationDate: lot.expirationDate ?? null,
          categoryId: lot.product.categoryId ?? null,
          laboratory: lot.product.laboratory ?? null,
          createdAt: now,
        });

        linesData.push({
          id: lineId,
          sessionId,
          snapshotId,
          productId: lot.productId,
          lotId: lot.id,
          productName: lot.product.commercialName,
          internalCode: lot.product.internalCode,
          lotCode: lot.batchNumber,
          locationCode: lot.locationCode ?? null,
          barcode: lot.product.barcodes[0]?.barcode ?? null,
          theoreticalQty: lot.currentStock,
          unitCost: cost,
          countedQty1: null,
          countedQty2: null,
          finalQty: null,
          difference: null,
          valueImpact: null,
          status: InventoryCountLineStatus.PENDING,
          requiresRecount: false,
          isHighValue,
          notes: null,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Bulk insert
      // Prisma createMany does not support Decimal objects in some adapters, but PGlite does via Prisma layer.
      await tx.inventoryCountSnapshot.createMany({ data: snapshotsData });
      await tx.inventoryCountLine.createMany({ data: linesData });

      const updated = await tx.inventoryCountSession.update({
        where: { id: sessionId },
        data: {
          state: InventoryCountState.IN_PROGRESS,
          scopeLabel,
          totalLines: lots.length,
          countedLines: 0,
          recountedLines: 0,
          discrepancyCount: 0,
          startedAt: now,
          updatedAt: now,
        },
      });
      return mapSession(updated);
    });
  }

  async listLines(sessionId: string, opts?: { status?: InventoryCountLineStatus; search?: string; onlyRecount?: boolean; take?: number; skip?: number }): Promise<{ items: CountLineDto[]; total: number }> {
    this.auth.requireRole(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN);
    const s = await (this.prisma as any).inventoryCountSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new InventoryCountNotFoundException(sessionId);

    const where: any = { sessionId };
    if (opts?.status) where.status = opts.status;
    if (opts?.onlyRecount) where.requiresRecount = true;
    if (opts?.search?.trim()) {
      const q = opts.search.trim();
      where.OR = [
        { productName: { contains: q, mode: 'insensitive' } },
        { lotCode: { contains: q, mode: 'insensitive' } },
        { internalCode: { contains: q, mode: 'insensitive' } },
        { barcode: { contains: q, mode: 'insensitive' } },
        { locationCode: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [total, rows] = await Promise.all([
      (this.prisma as any).inventoryCountLine.count({ where }),
      (this.prisma as any).inventoryCountLine.findMany({
        where,
        orderBy: [{ isHighValue: 'desc' }, { productName: 'asc' }, { lotCode: 'asc' }],
        take: opts?.take ?? 200,
        skip: opts?.skip ?? 0,
      }),
    ]);
    return { total, items: rows.map(mapLine) };
  }

  async getProgress(sessionId: string): Promise<CountProgress> {
    this.auth.requireRole(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN);
    const s = await (this.prisma as any).inventoryCountSession.findUnique({ where: { id: sessionId }, select: { totalLines: true } });
    if (!s) throw new InventoryCountNotFoundException(sessionId);

    const [counted, recountNeeded, recounted, resolved, discrepancy] = await Promise.all([
      (this.prisma as any).inventoryCountLine.count({ where: { sessionId, status: { not: InventoryCountLineStatus.PENDING } } }),
      (this.prisma as any).inventoryCountLine.count({ where: { sessionId, requiresRecount: true } }),
      (this.prisma as any).inventoryCountLine.count({ where: { sessionId, countedQty2: { not: null } } }),
      (this.prisma as any).inventoryCountLine.count({ where: { sessionId, status: InventoryCountLineStatus.RESOLVED } }),
      (this.prisma as any).inventoryCountLine.count({ where: { sessionId, difference: { not: 0 } } }),
    ]);
    const total = s.totalLines;
    return {
      total,
      counted,
      recountNeeded,
      recounted,
      resolved,
      discrepancy,
      percent: total === 0 ? 0 : Math.round((counted / total) * 100),
    };
  }

  /**
   * Record first or second count for a line.
   *
   * - If the line has no countedQty1, this is count 1.
   * - Otherwise it is count 2 (recount).
   * Computes difference, valueImpact, status, and requiresRecount intelligently.
   */
  async recordCount(lineId: string, qty: number, opts?: { note?: string }): Promise<CountLineDto> {
    this.auth.requireRole(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN);
    if (!Number.isInteger(qty) || qty < 0) throw new InventoryCountNotReadyToCloseException('Quantity must be a non-negative integer.');

    return (this.prisma as any).$transaction(async (tx: any) => {
      const line: any = await tx.inventoryCountLine.findUnique({ where: { id: lineId } });
      if (!line) throw new InventoryCountLineNotFoundException(lineId);

      const session: any = await tx.inventoryCountSession.findUnique({ where: { id: line.sessionId } });
      if (!session) throw new InventoryCountNotFoundException(line.sessionId);
      if (session.state !== InventoryCountState.IN_PROGRESS) throw new InventoryCountStateException(session.id, session.state, InventoryCountState.IN_PROGRESS);

      const now = new Date();
      const isFirstCount = line.countedQty1 == null;
      const patch: any = { updatedAt: now };
      if (opts?.note !== undefined) patch.notes = opts.note;

      if (isFirstCount) {
        patch.countedQty1 = qty;
        patch.countedAt1 = now;
        // provisional final = qty (may be overwritten after recount evaluation)
        patch.finalQty = qty;
        patch.difference = qty - line.theoreticalQty;
        patch.valueImpact = new Prisma.Decimal(qty - line.theoreticalQty).mul(line.unitCost);

        // Decide if recount needed immediately (tolerant check)
        const needsRecount = shouldRequireRecount({
          theoretical: line.theoreticalQty,
          counted: qty,
          tolerancePercent: session.tolerancePercent,
          requireDoubleCount: session.requireDoubleCount,
          isHighValue: line.isHighValue,
        });

        patch.requiresRecount = needsRecount;
        patch.status = needsRecount ? InventoryCountLineStatus.RECOUNT_NEEDED : InventoryCountLineStatus.COUNTED;

        // Zero-count on high-value or non-zero theoretical triggers review hint
        // but we still allow COUNTED; second pass via evaluateRecounts will enforce.
      } else {
        // Second count
        patch.countedQty2 = qty;
        patch.countedAt2 = now;

        // Resolve finalQty: if both counts agree → that value; if one matches theoretical → theoretical wins? No, trust second count for now.
        // Intelligence: if c1 == c2 → final = c1 (confirmed). If c2 == theoretical and c1 != theoretical → c2 likely correct, take c2.
        // If all three differ → requires manual review.
        let finalQty: number;
        let status: InventoryCountLineStatus;
        const c1 = line.countedQty1 as number;
        const theoretical = line.theoreticalQty as number;

        if (qty === c1) {
          finalQty = qty;
          status = InventoryCountLineStatus.RESOLVED;
          patch.requiresRecount = false;
        } else if (qty === theoretical) {
          finalQty = qty;
          // even though matches theoretical, second count confirms no adjustment needed
          status = InventoryCountLineStatus.RESOLVED;
          patch.requiresRecount = false;
        } else if (c1 === theoretical && qty !== theoretical) {
          // First matched theoretical, second diverged → keep requires review
          finalQty = qty;
          status = InventoryCountLineStatus.REQUIRES_REVIEW;
          patch.requiresRecount = false;
        } else {
          // Triple mismatch
          finalQty = qty;
          status = InventoryCountLineStatus.REQUIRES_REVIEW;
          patch.requiresRecount = false;
        }

        patch.finalQty = finalQty;
        patch.difference = finalQty - theoretical;
        patch.valueImpact = new Prisma.Decimal(finalQty - theoretical).mul(line.unitCost);
        patch.status = status;
        if (status === InventoryCountLineStatus.RESOLVED) patch.resolvedAt = now;
      }

      const updated = await tx.inventoryCountLine.update({ where: { id: lineId }, data: patch });

      // Update denormalized counters on session
      await this.refreshSessionCounters(tx, session.id);

      return mapLine(updated);
    });
  }

  /**
   * Batch evaluate recounts — call after first pass completes or on demand.
   * Marks lines where abs(diff) > tolerance or value impact high.
   */
  async evaluateRecounts(sessionId: string): Promise<{ marked: number }> {
    this.auth.requireRole(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN);
    return (this.prisma as any).$transaction(async (tx: any) => {
      const s: any = await tx.inventoryCountSession.findUnique({ where: { id: sessionId } });
      if (!s) throw new InventoryCountNotFoundException(sessionId);
      if (s.state !== InventoryCountState.IN_PROGRESS) throw new InventoryCountStateException(sessionId, s.state, InventoryCountState.IN_PROGRESS);

      const lines: any[] = await tx.inventoryCountLine.findMany({ where: { sessionId, countedQty1: { not: null } } });
      let marked = 0;
      for (const line of lines) {
        const should = shouldRequireRecount({
          theoretical: line.theoreticalQty,
          counted: line.countedQty1 as number,
          tolerancePercent: s.tolerancePercent,
          requireDoubleCount: s.requireDoubleCount,
          isHighValue: line.isHighValue,
        });
        const targetStatus = should ? InventoryCountLineStatus.RECOUNT_NEEDED : InventoryCountLineStatus.COUNTED;
        // Don't downgrade already recounted / resolved
        if (line.countedQty2 != null) continue;
        if (line.requiresRecount === should && line.status === targetStatus) continue;
        await tx.inventoryCountLine.update({
          where: { id: line.id },
          data: { requiresRecount: should, status: targetStatus },
        });
        if (should) marked++;
      }
      await this.refreshSessionCounters(tx, sessionId);
      return { marked };
    });
  }

  async setFinalQty(lineId: string, finalQty: number): Promise<CountLineDto> {
    this.auth.requireRole(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN);
    if (!Number.isInteger(finalQty) || finalQty < 0) throw new InventoryCountNotReadyToCloseException('Final quantity must be a non-negative integer.');
    return (this.prisma as any).$transaction(async (tx: any) => {
      const line: any = await tx.inventoryCountLine.findUnique({ where: { id: lineId } });
      if (!line) throw new InventoryCountLineNotFoundException(lineId);
      const s: any = await tx.inventoryCountSession.findUnique({ where: { id: line.sessionId } });
      if (!s) throw new InventoryCountNotFoundException(line.sessionId);
      // Allow final override in IN_PROGRESS or IN_REVIEW
      if (![InventoryCountState.IN_PROGRESS, InventoryCountState.IN_REVIEW].includes(s.state)) {
        throw new InventoryCountStateException(s.id, s.state, 'IN_PROGRESS or IN_REVIEW');
      }
      const diff = finalQty - line.theoreticalQty;
      const valueImpact = new Prisma.Decimal(diff).mul(line.unitCost);
      const updated = await tx.inventoryCountLine.update({
        where: { id: lineId },
        data: {
          finalQty,
          difference: diff,
          valueImpact,
          status: InventoryCountLineStatus.RESOLVED,
          requiresRecount: false,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await this.refreshSessionCounters(tx, s.id);
      return mapLine(updated);
    });
  }

  async moveToReview(sessionId: string): Promise<CountSessionDto> {
    this.auth.requireRole(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN);
    return (this.prisma as any).$transaction(async (tx: any) => {
      const s: any = await tx.inventoryCountSession.findUnique({ where: { id: sessionId } });
      if (!s) throw new InventoryCountNotFoundException(sessionId);
      if (s.state !== InventoryCountState.IN_PROGRESS) throw new InventoryCountStateException(sessionId, s.state, InventoryCountState.IN_PROGRESS);

      const pending = await tx.inventoryCountLine.count({ where: { sessionId, status: InventoryCountLineStatus.PENDING } });
      if (pending > 0) throw new InventoryCountNotReadyToCloseException(`${pending} line(s) still pending. Complete all counts first.`);

      const recountNeeded = await tx.inventoryCountLine.count({ where: { sessionId, status: InventoryCountLineStatus.RECOUNT_NEEDED } });
      if (recountNeeded > 0) throw new InventoryCountNotReadyToCloseException(`${recountNeeded} line(s) require recount. Complete second counts before review.`);

      // Auto-resolve lines that are COUNTED or RECOUNTED but not yet RESOLVED where no manual review needed
      const toResolve: any[] = await tx.inventoryCountLine.findMany({
        where: { sessionId, status: { in: [InventoryCountLineStatus.COUNTED, InventoryCountLineStatus.RECOUNTED] } },
      });
      for (const line of toResolve) {
        // If no recount required, promote to RESOLVED
        if (!line.requiresRecount) {
          await tx.inventoryCountLine.update({
            where: { id: line.id },
            data: { status: InventoryCountLineStatus.RESOLVED, resolvedAt: new Date() },
          });
        }
      }

      // Allow REQUIRES_REVIEW to stay — review screen will handle them. Block only PENDING/RECOUNT_NEEDED.
      const blocking = await tx.inventoryCountLine.count({
        where: { sessionId, status: { in: [InventoryCountLineStatus.PENDING, InventoryCountLineStatus.RECOUNT_NEEDED] } },
      });
      if (blocking > 0) throw new InventoryCountNotReadyToCloseException(`${blocking} line(s) still blocking review.`);

      const updated = await tx.inventoryCountSession.update({
        where: { id: sessionId },
        data: { state: InventoryCountState.IN_REVIEW, reviewedAt: new Date(), updatedAt: new Date() },
      });
      await this.refreshSessionCounters(tx, sessionId);
      return mapSession(updated);
    });
  }

  async closeSession(sessionId: string): Promise<CountSessionDto> {
    const authSession = this.auth.requireRole(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN);

    return (this.prisma as any).$transaction(async (tx: any) => {
      const s: any = await tx.inventoryCountSession.findUnique({ where: { id: sessionId } });
      if (!s) throw new InventoryCountNotFoundException(sessionId);
      if (s.state !== InventoryCountState.IN_REVIEW) throw new InventoryCountStateException(sessionId, s.state, InventoryCountState.IN_REVIEW);

      // We allow REQUIRES_REVIEW lines but they must have a manual finalQty set; COUNTED lines should have been auto-resolved.
      await tx.inventoryCountLine.count({
        where: { sessionId, status: { notIn: [InventoryCountLineStatus.RESOLVED, InventoryCountLineStatus.REQUIRES_REVIEW] } },
      });
      const requiresReviewWithoutFinal = await tx.inventoryCountLine.count({
        where: { sessionId, status: InventoryCountLineStatus.REQUIRES_REVIEW, finalQty: null },
      });
      if (requiresReviewWithoutFinal > 0) throw new InventoryCountNotReadyToCloseException(`${requiresReviewWithoutFinal} line(s) require manual final quantity before closing.`);

      const pendingFinal = await tx.inventoryCountLine.count({ where: { sessionId, finalQty: null } });
      if (pendingFinal > 0) throw new InventoryCountNotReadyToCloseException(`${pendingFinal} line(s) missing final quantity.`);

      const lines: any[] = await tx.inventoryCountLine.findMany({ where: { sessionId } });
      const diffs = lines.filter((l: any) => (l.difference ?? 0) !== 0);
      // If no diffs, just close without adjustments
      if (diffs.length === 0) {
        const closed = await tx.inventoryCountSession.update({
          where: { id: sessionId },
          data: { state: InventoryCountState.CLOSED, closedAt: new Date(), updatedAt: new Date(), discrepancyCount: 0 },
        });
        return mapSession(closed);
      }

      // Create a single InventoryAdjustmentDocument representing the entire count
      const counter = await tx.inventoryAdjustmentCounter.upsert({
        where: { id: 'singleton' },
        update: { lastSequentialNumber: { increment: 1 } },
        create: { id: 'singleton', lastSequentialNumber: 1 },
      });
      const freshCounter = await tx.inventoryAdjustmentCounter.findUnique({ where: { id: 'singleton' } });
      const seq = freshCounter?.lastSequentialNumber ?? counter.lastSequentialNumber;

      const adjustmentId = globalThis.crypto.randomUUID();
      const now = new Date();
      const adjustment = await tx.inventoryAdjustmentDocument.create({
        data: {
          id: adjustmentId,
          sequentialNumber: seq,
          state: AdjustmentState.APPLIED,
          reason: `Reconteo ${s.code}${s.name ? ` — ${s.name}` : ''}`,
          notes: s.notes ?? `Cierre reconteo ${s.code}. Líneas con diferencia: ${diffs.length}/${lines.length}`,
          createdByUserId: authSession.userId,
          appliedAt: now,
          physicalCountId: null,
        },
      });

      // Apply stock mutations per diff line
      for (const line of diffs) {
        const diff: number = line.difference as number;
        const lotId: string | null = line.lotId;
        const productId: string = line.productId;

        if (diff > 0) {
          // Positive: add to lot (or first active lot if lotId null — shouldn't happen)
          let targetLotId = lotId;
          let lot: any = null;
          if (targetLotId) {
            lot = await tx.lot.findUnique({ where: { id: targetLotId } });
          }
          if (!lot) {
            // Fallback: first active lot for product, or create error? For count we must have lot, so fail loudly
            const fallback = await tx.lot.findFirst({ where: { productId, state: LotState.ACTIVE }, orderBy: { expirationDate: 'asc' } });
            if (!fallback) throw new InventoryCountNotReadyToCloseException(`No active lot found for product ${line.productName} to apply positive adjustment.`);
            targetLotId = fallback.id;
            lot = fallback;
          }
          const newStock = lot.currentStock + diff;
          const updatedRows = await tx.lot.updateMany({
            where: { id: lot.id, version: lot.version },
            data: { currentStock: newStock, version: { increment: 1 }, state: newStock > 0 && lot.state === LotState.EXHAUSTED ? LotState.ACTIVE : lot.state },
          });
          if (updatedRows.count === 0) throw new Error(`Lot version conflict on ${lot.id}`);
          await tx.inventoryMovement.create({
            data: {
              id: globalThis.crypto.randomUUID(),
              lotId: lot.id,
              movementType: MovementType.PHYSICAL_COUNT,
              quantity: diff,
              previousStock: lot.currentStock,
              resultingStock: newStock,
              createdById: authSession.userId,
              createdAt: now,
              adjustmentDocumentId: adjustmentId,
              reason: `Reconteo ${s.code} — +${diff}`,
            },
          });
        } else if (diff < 0) {
          const abs = Math.abs(diff);
          let remaining = abs;
          if (lotId) {
            const lot: any = await tx.lot.findUnique({ where: { id: lotId } });
            if (!lot) throw new InventoryCountNotReadyToCloseException(`Lot ${lotId} not found for product ${line.productName}.`);
            if (lot.currentStock < remaining) {
              // For count we allow negative to go to 0 and track discrepancy — but don't allow negative stock.
              // Clamp: only remove what exists; remaining diff beyond stock is still recorded but stock stays 0.
              remaining = lot.currentStock;
            }
            if (remaining > 0) {
              const newStock = lot.currentStock - remaining;
              const updatedRows = await tx.lot.updateMany({
                where: { id: lot.id, version: lot.version },
                data: { currentStock: newStock, version: { increment: 1 }, state: newStock === 0 ? LotState.EXHAUSTED : lot.state },
              });
              if (updatedRows.count === 0) throw new Error(`Lot version conflict on ${lot.id}`);
              await tx.inventoryMovement.create({
                data: {
                  id: globalThis.crypto.randomUUID(),
                  lotId: lot.id,
                  movementType: MovementType.PHYSICAL_COUNT,
                  quantity: remaining,
                  previousStock: lot.currentStock,
                  resultingStock: newStock,
                  createdById: authSession.userId,
                  createdAt: now,
                  adjustmentDocumentId: adjustmentId,
                  reason: `Reconteo ${s.code} — -${remaining}`,
                },
              });
            }
          } else {
            // No lotId — FEFO across lots
            const lotsForProduct: any[] = await tx.lot.findMany({
              where: { productId, state: LotState.ACTIVE, currentStock: { gt: 0 } },
              orderBy: { expirationDate: 'asc' },
            });
            for (const lot of lotsForProduct) {
              if (remaining <= 0) break;
              const take = Math.min(remaining, lot.currentStock);
              const newStock = lot.currentStock - take;
              const updatedRows = await tx.lot.updateMany({
                where: { id: lot.id, version: lot.version },
                data: { currentStock: newStock, version: { increment: 1 }, state: newStock === 0 ? LotState.EXHAUSTED : lot.state },
              });
              if (updatedRows.count === 0) throw new Error(`Lot version conflict on ${lot.id}`);
              await tx.inventoryMovement.create({
                data: {
                  id: globalThis.crypto.randomUUID(),
                  lotId: lot.id,
                  movementType: MovementType.PHYSICAL_COUNT,
                  quantity: take,
                  previousStock: lot.currentStock,
                  resultingStock: newStock,
                  createdById: authSession.userId,
                  createdAt: now,
                  adjustmentDocumentId: adjustmentId,
                  reason: `Reconteo ${s.code} — FEFO -${take}`,
                },
              });
              remaining -= take;
            }
          }
        }
      }

      // Sync queue entry — reuse INVENTORY_ADJUSTMENT shape so server replays same mutations
      const movements: any[] = await tx.inventoryMovement.findMany({ where: { adjustmentDocumentId: adjustmentId } });
      const lotIds = movements.map((m: any) => m.lotId).filter(Boolean);
      const lotsDetailed: any[] = lotIds.length > 0 ? await tx.lot.findMany({ where: { id: { in: lotIds } }, select: { id: true, batchNumber: true, expirationDate: true, productId: true, currentStock: true, locationCode: true } }) : [];
      const lotMap = new Map(lotsDetailed.map((l: any) => [l.id, l]));

      // Build `lot -> diff` map to correctly classify PHYSICAL_COUNT movements.
      // Movements store `quantity` as absolute value for both + and - diffs, so
      // inferring type from `quantity > 0` would always yield POSITIVE.
      const diffByLotId = new Map<string, number>();
      const diffByProductIdForNullLot = new Map<string, number>();
      for (const d of diffs as any[]) {
        if (d.lotId) diffByLotId.set(d.lotId as string, d.difference as number);
        else diffByProductIdForNullLot.set(d.productId as string, d.difference as number);
      }

      const payloadObj = {
        userId: authSession.userId,
        createAdjustmentDto: {
          reason: adjustment.reason,
          notes: adjustment.notes,
          items: movements.map((m: any) => {
            const lot = lotMap.get(m.lotId);
            let diffForLot: number | undefined = diffByLotId.get(m.lotId as string);
            if (diffForLot === undefined && lot) {
              diffForLot = diffByProductIdForNullLot.get(lot.productId as string);
            }
            const isPositive = diffForLot !== undefined ? diffForLot > 0 : false;
            return {
              lotId: m.lotId,
              movementType: isPositive ? 'POSITIVE_ADJUSTMENT' : 'NEGATIVE_ADJUSTMENT',
              quantity: m.quantity,
              reason: m.reason ?? undefined,
              lot: lot ? { batchNumber: lot.batchNumber, expirationDate: lot.expirationDate.toISOString(), productId: lot.productId, currentStock: lot.currentStock, locationCode: lot.locationCode ?? undefined } : undefined,
            };
          }),
        },
        metadata: {
          adjustmentId,
          sequentialNumber: seq,
          workstationId: authSession.workstationId,
          appliedAt: now.toISOString(),
          source: 'PHYSICAL_COUNT',
          countSessionId: s.id,
          countCode: s.code,
        },
      };
      const payload = JSON.stringify(payloadObj);
      const payloadBytes = new TextEncoder().encode(payload);
      const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', payloadBytes);
      const payloadHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const operationUuid = globalThis.crypto.randomUUID();
      const latestSeq = await tx.syncQueue.findFirst({ where: { sourceWorkstationId: authSession.workstationId }, orderBy: { clientSequence: 'desc' }, select: { clientSequence: true } });
      const clientSequence: bigint = latestSeq ? (latestSeq.clientSequence as bigint) + 1n : 1n;

      await tx.syncQueue.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          operationUuid,
          operationType: 'INVENTORY_ADJUSTMENT',
          payload,
          payloadHash,
          payloadSize: payloadBytes.length,
          versionSchema: 1,
          status: 'PENDING',
          retryCount: 0,
          sourceWorkstationId: authSession.workstationId,
          sourceCreatedAt: now,
          clientSequence,
        },
      });

      // Close session
      const totalValueImpact = diffs.reduce((acc: Prisma.Decimal, l: any) => acc.add(l.valueImpact ?? new Prisma.Decimal(0)), new Prisma.Decimal(0));
      const closed = await tx.inventoryCountSession.update({
        where: { id: sessionId },
        data: {
          state: InventoryCountState.CLOSED,
          closedAt: now,
          updatedAt: now,
          adjustmentDocumentId: adjustmentId,
          discrepancyCount: diffs.length,
          totalValueImpact,
        },
      });
      return mapSession(closed);
    }).then((res: CountSessionDto) => {
      notifyPendingEntry();
      return res;
    });
  }

  async cancelSession(sessionId: string): Promise<CountSessionDto> {
    this.auth.requireRole(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN);
    const s: any = await (this.prisma as any).inventoryCountSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new InventoryCountNotFoundException(sessionId);
    if ([InventoryCountState.CLOSED, InventoryCountState.CANCELLED].includes(s.state)) throw new InventoryCountStateException(sessionId, s.state, 'cancellable state');
    const updated = await (this.prisma as any).inventoryCountSession.update({
      where: { id: sessionId },
      data: { state: InventoryCountState.CANCELLED, cancelledAt: new Date(), updatedAt: new Date() },
    });
    return mapSession(updated);
  }

  async deleteDraft(sessionId: string): Promise<void> {
    this.auth.requireRole(RoleType.ADMIN);
    const s: any = await (this.prisma as any).inventoryCountSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new InventoryCountNotFoundException(sessionId);
    if (s.state !== InventoryCountState.DRAFT) throw new InventoryCountStateException(sessionId, s.state, InventoryCountState.DRAFT);
    await (this.prisma as any).inventoryCountSession.delete({ where: { id: sessionId } });
  }

  /**
   * Get the SyncQueue status for a closed count session.
   *
   * Looks for the INVENTORY_ADJUSTMENT SyncQueue entry whose payload
   * metadata.countSessionId matches the session. The payload is stored as
   * JSON TEXT, so we fetch the last 20 INVENTORY_ADJUSTMENT entries and
   * scan in JS — the queue is tiny and this avoids raw SQL JSON operators
   * that differ between PGlite and Postgres.
   *
   * Returns null when the session is not yet closed or no queue entry exists
   * (e.g. close with 0 diffs creates no adjustment).
   */
  async getSyncStatus(sessionId: string): Promise<{
    status: string;
    operationUuid: string;
    lastError?: string | null;
    failureCategory?: string | null;
    retryCount: number;
    updatedAt: string;
    payloadSize?: number;
  } | null> {
    this.auth.requireRole(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN);
    // Not closed → no sync entry expected
    const s: any = await (this.prisma as any).inventoryCountSession.findUnique({ where: { id: sessionId }, select: { state: true, adjustmentDocumentId: true } });
    if (!s) throw new InventoryCountNotFoundException(sessionId);
    if (!s.adjustmentDocumentId) return null;

    const entries: any[] = await (this.prisma as any).syncQueue.findMany({
      where: { operationType: 'INVENTORY_ADJUSTMENT' },
      orderBy: { sourceCreatedAt: 'desc' },
      take: 20,
    });

    for (const e of entries) {
      try {
        const payload = JSON.parse(e.payload as string) as any;
        const meta = payload?.metadata as any;
        if (meta?.countSessionId === sessionId || meta?.adjustmentId === s.adjustmentDocumentId) {
          return {
            status: e.status as string,
            operationUuid: e.operationUuid as string,
            lastError: (e.lastErrorMessage as string | null) ?? null,
            failureCategory: (e.failureCategory as string | null) ?? null,
            retryCount: e.retryCount as number,
            updatedAt: (e.lastAttemptAt ?? e.sourceCreatedAt) instanceof Date ? (e.lastAttemptAt ?? e.sourceCreatedAt).toISOString() : String(e.lastAttemptAt ?? e.sourceCreatedAt),
            payloadSize: e.payloadSize as number | undefined,
          };
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Fix a failed sync payload for a closed session (pre-fix bug where
   * PHYSICAL_COUNT quantity always mapped to POSITIVE_ADJUSTMENT) and
   * re-queue it as PENDING — reuses the same `syncQueue` + `syncScheduler`
   * pipeline as any other INVENTORY_ADJUSTMENT, no separate endpoint.
   *
   * Only acts on FAILED/PERMANENT_FAILURE entries; PENDING/COMPLETED are
   * left untouched. Rebuilds the payload from the current `InventoryMovement`
   * rows (same logic as `closeSession` after the fix) so the server sees
   * the correct NEGATIVE vs POSITIVE types and can apply the stock.
   */
  async fixAndResync(sessionId: string): Promise<{ operationUuid: string; status: string }> {
    this.auth.requireRole(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN);
    const s: any = await (this.prisma as any).inventoryCountSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new InventoryCountNotFoundException(sessionId);
    if (s.state !== InventoryCountState.CLOSED) throw new InventoryCountStateException(sessionId, s.state, InventoryCountState.CLOSED);
    if (!s.adjustmentDocumentId) throw new InventoryCountNotReadyToCloseException('No adjustment to resync (close without diffs).');

    // Find the latest queue entry for this session
    const entries: any[] = await (this.prisma as any).syncQueue.findMany({
      where: { operationType: 'INVENTORY_ADJUSTMENT' },
      orderBy: { sourceCreatedAt: 'desc' },
      take: 20,
    });
    let target: any | null = null;
    for (const e of entries) {
      try {
        const p = JSON.parse(e.payload as string) as any;
        if (p?.metadata?.countSessionId === sessionId || p?.metadata?.adjustmentId === s.adjustmentDocumentId) {
          target = e;
          break;
        }
      } catch { continue; }
    }
    if (!target) throw new InventoryCountNotFoundException(sessionId);
    if (!['FAILED', 'PERMANENT_FAILURE'].includes(target.status as string)) {
      return { operationUuid: target.operationUuid as string, status: target.status as string };
    }

    // Rebuild correct payload from stored movements + diff map (same fix as close)
    const movements: any[] = await (this.prisma as any).inventoryMovement.findMany({ where: { adjustmentDocumentId: s.adjustmentDocumentId } });
    const lotIds = movements.map((m: any) => m.lotId).filter(Boolean);
    const lotsDetailed: any[] = lotIds.length > 0 ? await (this.prisma as any).lot.findMany({ where: { id: { in: lotIds } }, select: { id: true, batchNumber: true, expirationDate: true, productId: true, currentStock: true, locationCode: true } }) : [];
    const lotMap = new Map(lotsDetailed.map((l: any) => [l.id, l]));

    const lines: any[] = await (this.prisma as any).inventoryCountLine.findMany({ where: { sessionId } });
    const diffByLotId = new Map<string, number>();
    const diffByProductIdForNullLot = new Map<string, number>();
    for (const d of lines) {
      if (d.lotId) diffByLotId.set(d.lotId as string, d.difference as number);
      else diffByProductIdForNullLot.set(d.productId as string, d.difference as number);
    }

    const freshPayloadObj = {
      userId: target ? (JSON.parse(target.payload as string) as any).userId ?? s.createdByUserId : s.createdByUserId,
      createAdjustmentDto: {
        reason: s.adjustmentDocumentId ? (await (this.prisma as any).inventoryAdjustmentDocument.findUnique({ where: { id: s.adjustmentDocumentId }, select: { reason: true, notes: true } }).then((r: any) => r?.reason) ?? `Reconteo ${s.code}`) : `Reconteo ${s.code}`,
        notes: s.notes ?? null,
        items: movements.map((m: any) => {
          const lot = lotMap.get(m.lotId);
          let diffForLot: number | undefined = diffByLotId.get(m.lotId as string);
          if (diffForLot === undefined && lot) diffForLot = diffByProductIdForNullLot.get(lot.productId as string);
          const isPositive = diffForLot !== undefined ? diffForLot > 0 : false;
          return {
            lotId: m.lotId,
            movementType: isPositive ? 'POSITIVE_ADJUSTMENT' : 'NEGATIVE_ADJUSTMENT',
            quantity: m.quantity,
            reason: m.reason ?? undefined,
            lot: lot ? { batchNumber: lot.batchNumber, expirationDate: lot.expirationDate.toISOString(), productId: lot.productId, currentStock: lot.currentStock, locationCode: lot.locationCode ?? undefined } : undefined,
          };
        }),
      },
      metadata: (() => { try { return (JSON.parse(target.payload as string) as any).metadata; } catch { return {}; } })(),
    };
    // Ensure metadata.countSessionId is preserved
    if (!(freshPayloadObj.metadata as any).countSessionId) (freshPayloadObj.metadata as any).countSessionId = sessionId;

    const payload = JSON.stringify(freshPayloadObj);
    const payloadBytes = new TextEncoder().encode(payload);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', payloadBytes);
    const payloadHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const updated = await (this.prisma as any).syncQueue.update({
      where: { id: target.id },
      data: {
        payload,
        payloadHash,
        payloadSize: payloadBytes.length,
        status: 'PENDING',
        retryCount: 0,
        failureCategory: null,
        lastErrorMessage: null,
        nextRetryAt: null,
        lastAttemptAt: new Date(),
      },
    });

    // Trigger immediate push via same notifier as normal close
    notifyPendingEntry();

    return { operationUuid: updated.operationUuid as string, status: updated.status as string };
  }

  // ── Private ───────────────────────────────────────────────────────────

  private async refreshSessionCounters(tx: any, sessionId: string): Promise<void> {
    const [total, counted, , recounted, discrepancy] = await Promise.all([
      tx.inventoryCountLine.count({ where: { sessionId } }),
      tx.inventoryCountLine.count({ where: { sessionId, countedQty1: { not: null } } }),
      tx.inventoryCountLine.count({ where: { sessionId, requiresRecount: true } }),
      tx.inventoryCountLine.count({ where: { sessionId, countedQty2: { not: null } } }),
      tx.inventoryCountLine.count({ where: { sessionId, difference: { not: 0 } } }),
    ]);
    await tx.inventoryCountSession.update({
      where: { id: sessionId },
      data: { totalLines: total, countedLines: counted, recountedLines: recounted, discrepancyCount: discrepancy, updatedAt: new Date() },
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shouldRequireRecount(params: { theoretical: number; counted: number; tolerancePercent: number; requireDoubleCount: boolean; isHighValue: boolean }): boolean {
  if (!params.requireDoubleCount) return false;
  // High-value always requires recount on any diff
  if (params.isHighValue && params.counted !== params.theoretical) return true;
  if (params.theoretical === 0) return params.counted !== 0;
  const diff = Math.abs(params.counted - params.theoretical);
  const pct = (diff / Math.max(1, params.theoretical)) * 100;
  return pct > params.tolerancePercent;
}

function mapSession(row: any): CountSessionDto {
  return {
    id: row.id,
    code: row.code,
    sequentialNumber: row.sequentialNumber,
    name: row.name,
    state: row.state,
    scopeType: row.scopeType,
    scopeValue: row.scopeValue,
    scopeLabel: row.scopeLabel,
    mode: row.mode,
    tolerancePercent: row.tolerancePercent,
    requireDoubleCount: row.requireDoubleCount,
    totalLines: row.totalLines,
    countedLines: row.countedLines,
    recountedLines: row.recountedLines,
    discrepancyCount: row.discrepancyCount,
    totalValueImpact: row.totalValueImpact?.toString() ?? null,
    notes: row.notes,
    createdByUserId: row.createdByUserId,
    createdByUserName: row.createdByUserName,
    workstationId: row.workstationId,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    startedAt: row.startedAt ? (row.startedAt instanceof Date ? row.startedAt.toISOString() : String(row.startedAt)) : null,
    reviewedAt: row.reviewedAt ? (row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : String(row.reviewedAt)) : null,
    closedAt: row.closedAt ? (row.closedAt instanceof Date ? row.closedAt.toISOString() : String(row.closedAt)) : null,
    cancelledAt: row.cancelledAt ? (row.cancelledAt instanceof Date ? row.cancelledAt.toISOString() : String(row.cancelledAt)) : null,
    adjustmentDocumentId: row.adjustmentDocumentId ?? null,
  };
}

function mapLine(row: any): CountLineDto {
  return {
    id: row.id,
    sessionId: row.sessionId,
    productId: row.productId,
    lotId: row.lotId,
    productName: row.productName,
    internalCode: row.internalCode,
    lotCode: row.lotCode,
    locationCode: row.locationCode,
    barcode: row.barcode,
    theoreticalQty: row.theoreticalQty,
    unitCost: row.unitCost?.toString() ?? '0',
    countedQty1: row.countedQty1,
    countedQty2: row.countedQty2,
    finalQty: row.finalQty,
    difference: row.difference,
    valueImpact: row.valueImpact?.toString() ?? null,
    status: row.status,
    requiresRecount: row.requiresRecount,
    isHighValue: row.isHighValue,
    notes: row.notes,
  };
}
