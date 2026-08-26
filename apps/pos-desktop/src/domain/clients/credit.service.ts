/**
 * Credit service for the POS desktop app.
 *
 * Computes the store-credit balance for a registered client directly from
 * the local database:
 *
 *   debt = SUM(SalePayment.amount) on CONFIRMED (non-annulled) sales paid
 *          with a CREDIT payment method
 *        − SUM(ClientReturn.refundAmount) on CONFIRMED returns refunded
 *          via a CREDIT payment method
 *        − SUM(ClientCreditPayment.amount) — abonos toward the debt
 *        (clamped to 0)
 *
 * The effective limit is the client's own `creditLimit` row — materialized
 * at create/edit time (the form prefills the tenant default configured in
 * the sales settings) — so every workstation and the server agree on the
 * same number without a shared config lookup.
 *
 * Abonos (`recordCreditPayment`) are capped at the current debt, tied to a
 * payment method and the open cash shift, and replayed server-side through
 * the CLIENT_CREDIT_PAYMENT sync operation.
 */
import {
  PrismaClient,
  Prisma,
  SaleOperationalState,
  ClientReturnState,
} from '@pharmacy/database/local';
import type { AuthService } from '../auth/auth.service';
import { notifyPendingEntry } from '../sync/sync-queue-notifier';
import { RoleType } from '@pharmacy/shared-types';
import {
  CreditPaymentInvalidAmountException,
  CreditPaymentExceedsDebtException,
  NoOpenCashShiftForCreditPaymentException,
  CreditPaymentNotFoundException,
  CreditPaymentAlreadyAnnulledException,
  CreditPaymentInvalidAnnulmentReasonException,
} from './credit.exceptions';
import { CreditNotEnabledForClientException } from '../sales-pos/exceptions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientCreditState {
  clientId: string;
  /** Effective credit limit in COP cents. 0 = credit disabled. */
  creditLimitCents: number;
  /** Current debt in COP cents. */
  usedCents: number;
  /** creditLimitCents − usedCents, clamped to ≥ 0. */
  availableCents: number;
  /** True when the client has credit enabled (limit > 0). */
  enabled: boolean;
}

export type CreditHistoryEntryKind = 'SALE' | 'RETURN' | 'PAYMENT';

/**
 * One credit movement in the client's credit history.
 *
 * `SALE`: confirmed sale paid (at least in part) with a CREDIT method —
 * accumulates debt. `RETURN`: confirmed return refunded via a CREDIT
 * method — pays debt down. `PAYMENT`: an abono recorded toward the debt.
 */
export interface CreditHistoryEntry {
  kind: CreditHistoryEntryKind;
  /** Sale, return, or payment id. */
  id: string;
  /** ISO timestamp of the movement. */
  date: string;
  /** The CREDIT portion of the movement in COP cents. */
  amountCents: number;
  /** Display reference: `#<localNumber>` sales, `D-XXXXXX` returns, `AB-XXXXXX` abonos. */
  reference: string;
  /** Payment method name (e.g. "Crédito", "Efectivo"). */
  methodName: string;
  /** True when a PAYMENT (abono) was annulled by an admin. */
  annulled?: boolean;
  /** Annulment reason, when the abono was annulled. */
  annulmentReason?: string | null;
}

export interface CreditHistoryResult {
  items: CreditHistoryEntry[];
  /** Total debt in COP cents (same value as `getCreditDebtCents`). */
  debtCents: number;
  /** True when at least one CREDIT payment method exists locally. */
  creditEnabled: boolean;
}

export interface RecordCreditPaymentInput {
  clientId: string;
  /** Amount in COP cents. Must be > 0 and ≤ the client's current debt. */
  amountCents: number;
  /** Payment method used by the client (cash, card, …). */
  paymentMethodId: string;
  notes?: string;
}

export interface CreditPaymentRecord {
  id: string;
  sequentialNumber: number;
  clientId: string;
  /** Amount in COP cents. */
  amountCents: number;
  paymentMethodId: string;
  notes: string | null;
  createdAt: string;
  /** Remaining debt after the payment, in COP cents. */
  remainingDebtCents: number;
}

/**
 * Minimal Prisma surface the credit debt/history queries touch — shared by
 * the service client and the transaction client.
 */
type CreditQueryClient = Pick<
  PrismaClient,
  'paymentMethod' | 'salePayment' | 'clientReturn' | 'clientCreditPayment'
>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createCreditService = (
  prisma: PrismaClient,
  auth: AuthService,
): CreditService => new CreditService(prisma, auth);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CreditService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
  ) {}

  /**
   * Full credit state (limit, debt, available) for a client.
   *
   * Returns null when the client does not exist. Credit is disabled when
   * the client has no positive limit.
   */
  async getCreditState(clientId: string): Promise<ClientCreditState | null> {
    this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, creditLimit: true },
    });
    if (!client) return null;

    const creditLimitCents = this.decimalToCents(client.creditLimit);
    const usedCents = await this.getCreditDebtCents(clientId);
    const availableCents = Math.max(0, creditLimitCents - usedCents);

    return {
      clientId,
      creditLimitCents,
      usedCents,
      availableCents,
      enabled: creditLimitCents > 0,
    };
  }

  /**
   * Credit history for a client — recent confirmed credit sales, confirmed
   * credit refunds, and abonos, merged and sorted newest-first.
   */
  async getCreditHistory(
    clientId: string,
    limit = 10,
  ): Promise<CreditHistoryResult> {
    this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    const creditMethods = await this.prisma.paymentMethod.findMany({
      where: { category: 'CREDIT' },
      select: { id: true, name: true },
    });
    if (creditMethods.length === 0) {
      return { items: [], debtCents: 0, creditEnabled: false };
    }
    const ids = creditMethods.map((m) => m.id);
    const creditMethodNameById = new Map(creditMethods.map((m) => [m.id, m.name]));

    const [payments, returns, abonos] = await Promise.all([
      this.prisma.salePayment.findMany({
        where: {
          sale: { clientId, operationalState: SaleOperationalState.CONFIRMED },
          paymentMethodId: { in: ids },
        },
        orderBy: { createdAt: 'desc' as const },
        take: limit,
        select: {
          id: true,
          amount: true,
          createdAt: true,
          paymentMethod: { select: { name: true } },
          sale: { select: { id: true, localNumber: true, confirmedAt: true } },
        },
      }),
      this.prisma.clientReturn.findMany({
        where: {
          clientId,
          state: ClientReturnState.CONFIRMED,
          refundMethodId: { in: ids },
        },
        orderBy: { createdAt: 'desc' as const },
        take: limit,
        select: {
          id: true,
          sequentialNumber: true,
          refundAmount: true,
          createdAt: true,
          refundMethodId: true,
        },
      }),
      this.prisma.clientCreditPayment.findMany({
        where: { clientId },
        orderBy: { createdAt: 'desc' as const },
        take: limit,
        select: {
          id: true,
          sequentialNumber: true,
          amount: true,
          createdAt: true,
          paymentMethodId: true,
          annulledAt: true,
          annulmentReason: true,
        },
      }),
    ]);

    // Abonos can use any payment method (cash, card, …) — resolve their names
    // in a single extra lookup.
    const abonoMethodIds = [...new Set(abonos.map((a) => a.paymentMethodId))];
    const abonoMethods = abonoMethodIds.length
      ? await this.prisma.paymentMethod.findMany({
          where: { id: { in: abonoMethodIds } },
          select: { id: true, name: true },
        })
      : [];
    const abonoMethodNameById = new Map(abonoMethods.map((m) => [m.id, m.name]));

    const salesEntries: CreditHistoryEntry[] = payments.map((p) => ({
      kind: 'SALE',
      id: p.sale.id,
      date: (p.sale.confirmedAt ?? p.createdAt).toISOString(),
      amountCents: this.decimalToCents(p.amount),
      reference: `#${String(p.sale.localNumber)}`,
      methodName: p.paymentMethod.name,
    }));
    const returnEntries: CreditHistoryEntry[] = returns.map((r) => ({
      kind: 'RETURN',
      id: r.id,
      date: r.createdAt.toISOString(),
      amountCents: this.decimalToCents(r.refundAmount),
      reference: `D-${String(r.sequentialNumber).padStart(6, '0')}`,
      // `refundMethodId` is constrained to the credit methods above, so the
      // map lookup is guaranteed to hit.
      methodName: creditMethodNameById.get(r.refundMethodId) ?? '',
    }));
    const paymentEntries: CreditHistoryEntry[] = abonos.map((a) => ({
      kind: 'PAYMENT',
      id: a.id,
      date: a.createdAt.toISOString(),
      amountCents: this.decimalToCents(a.amount),
      reference: `AB-${String(a.sequentialNumber).padStart(6, '0')}`,
      methodName: abonoMethodNameById.get(a.paymentMethodId) ?? '',
      // Loose null check: Prisma returns `null` for an unset nullable
      // column, but unit mocks may omit the key entirely (undefined).
      annulled: a.annulledAt != null,
      annulmentReason: a.annulmentReason ?? null,
    }));

    const items = [...salesEntries, ...returnEntries, ...paymentEntries]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);

    return {
      items,
      debtCents: await this.getCreditDebtCents(clientId),
      creditEnabled: true,
    };
  }

  /**
   * Record a credit payment (abono) toward the client's debt.
   *
   * Validations: the client must exist with credit enabled (limit > 0), the
   * amount must be a positive number and must not exceed the current debt,
   * and an open cash shift must exist for the workstation (the abono is tied
   * to it for cash reconciliation).
   *
   * The payment row and the CLIENT_CREDIT_PAYMENT sync-queue entry are
   * created in the same transaction; a push is notified immediately after
   * commit so the server debt stays consistent across workstations.
   *
   * @throws CreditPaymentInvalidAmountException, CreditPaymentExceedsDebtException,
   *         NoOpenCashShiftForCreditPaymentException, CreditNotEnabledForClientException
   */
  async recordCreditPayment(
    input: RecordCreditPaymentInput,
  ): Promise<CreditPaymentRecord> {
    const session = this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);

    if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
      throw new CreditPaymentInvalidAmountException(input.amountCents);
    }

    const client = await this.prisma.client.findUnique({
      where: { id: input.clientId },
      select: { id: true, creditLimit: true },
    });
    if (!client || this.decimalToCents(client.creditLimit) <= 0) {
      throw new CreditNotEnabledForClientException(input.clientId);
    }

    const notes = input.notes?.trim() || null;

    const record = await this.prisma.$transaction(async (tx) => {
      // Recompute the debt inside the transaction so a concurrent credit
      // sale can't push the abono over the cap.
      const debtCents = await this.computeDebtCents(tx, input.clientId);
      if (input.amountCents > debtCents) {
        throw new CreditPaymentExceedsDebtException(input.amountCents, debtCents);
      }

      // The shift is global (opened by an admin, possibly at another
      // workstation), so the abono attaches to whatever OPEN shift exists.
      const cashShift = await tx.cashShift.findFirst({
        where: { state: 'OPEN' },
        select: { id: true },
      });
      if (!cashShift) {
        throw new NoOpenCashShiftForCreditPaymentException();
      }

      const id = globalThis.crypto.randomUUID();
      const createdAt = new Date();
      const sequentialNumber = await this.nextPaymentSequential(
        tx,
        session.workstationId,
      );
      // Decimal division (not float) so 12345 cents → 123.45 exactly.
      const amount = new Prisma.Decimal(input.amountCents).dividedBy(100);

      await tx.clientCreditPayment.create({
        data: {
          id,
          sequentialNumber,
          clientId: input.clientId,
          amount,
          paymentMethodId: input.paymentMethodId,
          notes,
          createdById: session.userId,
          cashShiftId: cashShift.id,
          workstationId: session.workstationId,
          createdAt,
          sourceWorkstationId: session.workstationId,
          sourceCreatedAt: createdAt,
        },
      });

      await this.createSyncQueueEntry(
        tx,
        {
          id,
          sequentialNumber,
          clientId: input.clientId,
          amountCents: input.amountCents,
          paymentMethodId: input.paymentMethodId,
          notes,
          createdById: session.userId,
          cashShiftId: cashShift.id,
          workstationId: session.workstationId,
          createdAt,
        },
        session,
      );

      return {
        id,
        sequentialNumber,
        clientId: input.clientId,
        amountCents: input.amountCents,
        paymentMethodId: input.paymentMethodId,
        notes,
        createdAt: createdAt.toISOString(),
        remainingDebtCents: Math.max(0, debtCents - input.amountCents),
      };
    });

    // Transaction committed — trigger an immediate push instead of waiting
    // for the scheduler cycle.
    notifyPendingEntry();
    return record;
  }

  /**
   * Annul a credit payment (abono).
   *
   * ADMIN-only, replicating the returns annulment pattern: the annulment
   * requires a mandatory reason, is terminal (a payment can be annulled
   * once), and is recorded locally with a CLIENT_CREDIT_PAYMENT_ANNULMENT
   * sync entry so the server applies the same reversal and every
   * workstation's debt computation stays consistent.
   *
   * The payment row and the sync-queue entry are created in the same
   * transaction; a push is notified immediately after commit.
   *
   * @throws CreditPaymentNotFoundException, CreditPaymentAlreadyAnnulledException,
   *         CreditPaymentInvalidAnnulmentReasonException
   */
  async annulCreditPayment(
    paymentId: string,
    reason: string,
  ): Promise<{
    id: string;
    sequentialNumber: number;
    clientId: string;
    /** ISO timestamp of the annulment. */
    annulledAt: string;
    /** Debt after the annulment — the abono no longer pays the debt down. */
    remainingDebtCents: number;
  }> {
    const session = this.auth.requireRole(RoleType.ADMIN);

    const trimmedReason = reason?.trim() ?? '';
    if (trimmedReason.length === 0 || trimmedReason.length > 1000) {
      throw new CreditPaymentInvalidAnnulmentReasonException();
    }

    const annulledAt = new Date();

    const record = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.clientCreditPayment.findUnique({
        where: { id: paymentId },
        select: {
          id: true,
          sequentialNumber: true,
          clientId: true,
          annulledAt: true,
        },
      });
      if (!payment) throw new CreditPaymentNotFoundException(paymentId);
      if (payment.annulledAt) {
        throw new CreditPaymentAlreadyAnnulledException(paymentId);
      }

      await tx.clientCreditPayment.update({
        where: { id: paymentId },
        data: {
          annulledAt,
          annulledById: session.userId,
          annulmentReason: trimmedReason,
        },
      });

      await this.createAnnulmentSyncQueueEntry(
        tx,
        { id: payment.id, clientId: payment.clientId },
        trimmedReason,
        session,
        annulledAt,
      );

      return {
        id: payment.id,
        sequentialNumber: payment.sequentialNumber,
        clientId: payment.clientId,
        annulledAt: annulledAt.toISOString(),
        // The debt is recomputed inside the transaction after the annulment
        // flag is set, so the returned balance already reflects the reversal.
        remainingDebtCents: await this.computeDebtCents(tx, payment.clientId),
      };
    });

    // Transaction committed — trigger an immediate push instead of waiting
    // for the scheduler cycle.
    notifyPendingEntry();
    return record;
  }

  /**
   * Current credit debt in COP cents for a client.
   *
   * Confirmed sales paid with a CREDIT method accumulate debt; confirmed
   * client returns refunded via a CREDIT method and recorded abonos pay it
   * down. Returns 0 when no CREDIT payment method exists locally yet.
   */
  async getCreditDebtCents(clientId: string): Promise<number> {
    this.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);
    return this.computeDebtCents(this.prisma, clientId);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Debt = credit sales − credit returns − abonos, clamped to ≥ 0.
   * Works on both the service client and a transaction client.
   */
  private async computeDebtCents(
    db: CreditQueryClient,
    clientId: string,
  ): Promise<number> {
    const creditMethodIds = (
      await db.paymentMethod.findMany({
        where: { category: 'CREDIT' },
        select: { id: true },
      })
    ).map((m) => m.id);
    if (creditMethodIds.length === 0) return 0;

    const [salesDebt, creditRefunds, creditPayments] = await Promise.all([
      db.salePayment.aggregate({
        where: {
          sale: { clientId, operationalState: SaleOperationalState.CONFIRMED },
          paymentMethod: { category: 'CREDIT' },
        },
        _sum: { amount: true },
      }),
      db.clientReturn.aggregate({
        where: {
          clientId,
          state: ClientReturnState.CONFIRMED,
          refundMethodId: { in: creditMethodIds },
        },
        _sum: { refundAmount: true },
      }),
      db.clientCreditPayment.aggregate({
        where: { clientId, annulledAt: null },
        _sum: { amount: true },
      }),
    ]);

    const debtCents = this.decimalToCents(salesDebt._sum.amount ?? null);
    const refundCents = this.decimalToCents(creditRefunds._sum.refundAmount ?? null);
    const paymentCents = this.decimalToCents(creditPayments._sum.amount ?? null);
    return Math.max(0, debtCents - refundCents - paymentCents);
  }

  /** Next sequential abono number per workstation. */
  private async nextPaymentSequential(
    tx: Prisma.TransactionClient,
    workstationId: string,
  ): Promise<number> {
    const latest = await tx.clientCreditPayment.findFirst({
      where: { workstationId },
      orderBy: { sequentialNumber: 'desc' },
      select: { sequentialNumber: true },
    });
    return latest ? latest.sequentialNumber + 1 : 1;
  }

  /**
   * Insert the CLIENT_CREDIT_PAYMENT sync-queue entry inside the same
   * transaction that creates the payment, following the returns flow.
   */
  private async createSyncQueueEntry(
    tx: Prisma.TransactionClient,
    payment: {
      id: string;
      sequentialNumber: number;
      clientId: string;
      amountCents: number;
      paymentMethodId: string;
      notes: string | null;
      createdById: string;
      cashShiftId: string;
      workstationId: string;
      createdAt: Date;
    },
    session: { userId: string; workstationId: string },
  ): Promise<void> {
    const payloadObj = {
      paymentId: payment.id,
      sequentialNumber: payment.sequentialNumber,
      clientId: payment.clientId,
      amount: (payment.amountCents / 100).toFixed(2),
      paymentMethodId: payment.paymentMethodId,
      notes: payment.notes,
      createdById: payment.createdById,
      cashShiftId: payment.cashShiftId,
      workstationId: payment.workstationId,
      metadata: {
        localPaymentId: payment.id,
        workstationId: session.workstationId,
        createdAt: payment.createdAt.toISOString(),
      },
    };

    await this.enqueueOperation(tx, {
      operationType: 'CLIENT_CREDIT_PAYMENT',
      payloadObj,
      session,
      sourceCreatedAt: payment.createdAt,
    });
  }

  /**
   * Insert the CLIENT_CREDIT_PAYMENT_ANNULMENT sync-queue entry inside the
   * same transaction that annuls the payment, mirroring the returns flow.
   */
  private async createAnnulmentSyncQueueEntry(
    tx: Prisma.TransactionClient,
    payment: { id: string; clientId: string },
    reason: string,
    session: { userId: string; workstationId: string },
    annulledAt: Date,
  ): Promise<void> {
    const payloadObj = {
      paymentId: payment.id,
      clientId: payment.clientId,
      annulmentReason: reason,
      annulledById: session.userId,
      annulledAt: annulledAt.toISOString(),
      metadata: {
        localPaymentId: payment.id,
        workstationId: session.workstationId,
        annulledAt: annulledAt.toISOString(),
      },
    };

    await this.enqueueOperation(tx, {
      operationType: 'CLIENT_CREDIT_PAYMENT_ANNULMENT',
      payloadObj,
      session,
      sourceCreatedAt: annulledAt,
    });
  }

  /**
   * Shared sync-queue enqueue for both credit operations. Computes the next
   * per-workstation client sequence, hashes the payload, and creates the
   * PENDING entry inside the caller's transaction.
   */
  private async enqueueOperation(
    tx: Prisma.TransactionClient,
    args: {
      operationType:
        | 'CLIENT_CREDIT_PAYMENT'
        | 'CLIENT_CREDIT_PAYMENT_ANNULMENT';
      payloadObj: Record<string, unknown>;
      session: { userId: string; workstationId: string };
      sourceCreatedAt: Date;
    },
  ): Promise<void> {
    const payload = JSON.stringify(args.payloadObj);
    const payloadBytes = new TextEncoder().encode(payload);
    const payloadSize = payloadBytes.length;
    const payloadHash = await this.computePayloadHash(payload);
    const operationUuid = globalThis.crypto.randomUUID();

    const latestSeq = await tx.syncQueue.findFirst({
      where: { sourceWorkstationId: args.session.workstationId },
      orderBy: { clientSequence: 'desc' },
      select: { clientSequence: true },
    });
    const clientSequence = latestSeq ? latestSeq.clientSequence + 1n : 1n;

    await tx.syncQueue.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        operationUuid,
        operationType: args.operationType,
        payload,
        payloadHash,
        payloadSize,
        versionSchema: 1,
        status: 'PENDING',
        retryCount: 0,
        sourceWorkstationId: args.session.workstationId,
        sourceCreatedAt: args.sourceCreatedAt,
        clientSequence,
      },
    });
  }

  /** Hash a string payload using SHA-256 (Web Crypto API). */
  private async computePayloadHash(payload: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Convert a Prisma Decimal (pesos) to whole COP cents. */
  private decimalToCents(value: Prisma.Decimal | null): number {
    if (!value) return 0;
    return Math.max(0, Math.round(Number(value) * 100));
  }
}
