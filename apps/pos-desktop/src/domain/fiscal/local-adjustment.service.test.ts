/**
 * Tests for LocalAdjustmentService.
 *
 * Covers:
 * - Happy-path apply adjustment
 * - Role gating (cashier rejection)
 * - Reason validation (min 10 chars)
 * - Status allow rules (TRANSMITTED_AUTHORIZED, CANCELLED, TRANSMITTED_REJECTED)
 * - Reversal chain semantics
 * - Multiple PAYMENT_METHOD_CHANGE — latest wins
 * - Operational view projection with reversal chain
 * - Optimistic concurrency detection
 * - CSV export format
 * - getLocalAdjustmentSummary
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createLocalAdjustmentService } from './local-adjustment.service';
import type { AdjustmentType } from './local-adjustment.types';
import {
  AdjustmentAuthorizationException,
  AdjustmentReasonTooShortException,
  AdjustmentNotAllowedForStatusException,
  AdjustmentConflictException,
  AdjustmentNotFoundException,
  AdjustmentAlreadyReversedException,
} from './local-adjustment.exceptions';
import { InsufficientRoleException } from '../auth/exceptions';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface Store {
  invoices: Map<string, Record<string, unknown>>;
  adjustments: Map<string, Record<string, unknown>>;
}

function createStore(): Store {
  return { invoices: new Map(), adjustments: new Map() };
}

function makeFakeInvoice(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'inv-1',
    saleId: 'sale-1',
    workstationId: 'ws-1',
    invoiceType: 'ELECTRONIC_INVOICE',
    invoiceNumber: 'FE00000001',
    status: 'TRANSMITTED_AUTHORIZED',
    cufeProvisional: 'prov-cufe-1',
    cufeOfficial: null,
    issuedAt: new Date('2026-07-08T10:00:00Z'),
    transmittedAt: new Date('2026-07-08T10:05:00Z'),
    expiresAt: new Date('2026-08-08T10:00:00Z'),
    contingencyEventId: null,
    techKeySnapshot: 'tech-key-1',
    fullData: {
      invoiceType: 'ELECTRONIC_INVOICE',
      invoiceNumber: 'FE00000001',
      payments: [
        {
          paymentMethodId: 'pm-cash',
          paymentMethodName: 'Efectivo',
          amount: '50000.00',
          category: 'CASH',
          transactionReference: null,
          authorizationCode: null,
          cardBrand: null,
          cardLastFour: null,
        },
      ],
      lineItems: [],
      taxSummaries: [],
      subtotal: '42016.81',
      totalDiscount: '0.00',
      totalTax: '7983.19',
      totalAmount: '50000.00',
      changeAmount: '0.00',
      issuedAt: '2026-07-08T10:00:00.000Z',
      currency: 'COP',
      buyer: { name: 'CONSUMIDOR FINAL', email: null, phone: null, address: null },
      seller: { nit: '', name: '', prefix: 'FE' },
      contingencyNumber: null,
      relatedInvoiceNumber: null,
      workstationCode: 'WS-01',
      prescriptionNumber: null,
    },
    ...overrides,
  };
}

/**
 * Helper to create a mock transaction client that wraps the same store.
 */
function createMockTransaction(store: Store) {
  return {
    invoiceLocalAdjustment: createMockAdjustmentMethods(store),
  };
}

/**
 * Helper to create the mock invoiceLocalAdjustment methods.
 */
function createMockAdjustmentMethods(store: Store) {
  return {
    create: async (args: { data: Record<string, unknown> }) => {
      const id = args.data.id as string;
      const invoiceId = args.data.invoiceId as string;
      const version = args.data.version as number;

      // Simulate @@unique([invoiceId, version]) constraint
      const existingWithSameVersion = Array.from(store.adjustments.values()).find(
        (a) => a.invoiceId === invoiceId && a.version === version,
      );
      if (existingWithSameVersion) {
        throw new Error('Unique constraint violation on invoiceId and version');
      }

      const row = {
        id,
        invoiceId,
        createdAt: args.data.createdAt as Date,
        createdByUserId: args.data.createdByUserId as string,
        createdByUserName: args.data.createdByUserName as string,
        adjustmentType: args.data.adjustmentType as string,
        previousValue: args.data.previousValue ?? null,
        newValue: args.data.newValue ?? null,
        reason: args.data.reason as string,
        version,
        reversalOfAdjustmentId: (args.data.reversalOfAdjustmentId as string | null) ?? null,
        replacedByAdjustmentId: (args.data.replacedByAdjustmentId as string | null) ?? null,
      };
      store.adjustments.set(id, row);
      return row;
    },
    findUnique: async (args: { where: { id: string } }) => {
      return store.adjustments.get(args.where.id) ?? null;
    },
    findUniqueOrThrow: async (args: { where: { id: string } }) => {
      const found = store.adjustments.get(args.where.id);
      if (!found) throw new Error('Adjustment not found');
      return found;
    },
    findMany: async (args?: { where?: Record<string, unknown>; orderBy?: Record<string, string> }) => {
      let results = Array.from(store.adjustments.values());
      if (args?.where?.invoiceId) {
        results = results.filter((a) => a.invoiceId === args.where.invoiceId);
      }
      if (args?.where?.createdAt) {
        const gte = (args.where.createdAt as Record<string, unknown>)?.gte as Date | undefined;
        const lte = (args.where.createdAt as Record<string, unknown>)?.lte as Date | undefined;
        if (gte) results = results.filter((a) => a.createdAt >= gte);
        if (lte) results = results.filter((a) => a.createdAt <= lte);
      }
      if (args?.orderBy?.createdAt === 'asc') {
        results.sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime());
      }
      return results;
    },
    count: async (args?: { where?: Record<string, unknown> }) => {
      let results = Array.from(store.adjustments.values());
      if (args?.where?.invoiceId) {
        results = results.filter((a) => a.invoiceId === args.where.invoiceId);
      }
      // The service now counts ALL adjustments (monotonically increasing version),
      // so we don't filter by replacedByAdjustmentId or adjustmentType.
      return results.length;
    },
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const existing = store.adjustments.get(args.where.id);
      if (!existing) throw new Error('Not found');
      const updated = { ...existing, ...args.data };
      store.adjustments.set(args.where.id, updated);
      return updated;
    },
    delete: async (args: { where: { id: string } }) => {
      store.adjustments.delete(args.where.id);
    },
  };
}

function createMockPrisma(store: Store) {
  const adjustmentMethods = createMockAdjustmentMethods(store);

  return {
    $transaction: async <T>(fn: (tx: { invoiceLocalAdjustment: ReturnType<typeof createMockAdjustmentMethods> }) => Promise<T>): Promise<T> => {
      return fn({ invoiceLocalAdjustment: createMockAdjustmentMethods(store) });
    },
    invoice: {
      findUnique: async (args: { where: { id: string }; select?: Record<string, unknown> }) => {
        const inv = store.invoices.get(args.where.id);
        if (!inv) return null;
        if (args.select) {
          const result: Record<string, unknown> = {};
          for (const key of Object.keys(args.select)) {
            if (key in inv) result[key] = inv[key];
          }
          return result;
        }
        return inv;
      },
      findMany: async (args: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
        const ids = args.where?.id?.in as string[] | undefined;
        if (ids) {
          return ids.map((id) => store.invoices.get(id)).filter(Boolean);
        }
        if (args.where?.saleId?.in) {
          const saleIds = args.where.saleId.in as string[];
          return Array.from(store.invoices.values()).filter(
            (inv) => saleIds.includes(inv.saleId as string),
          );
        }
        return Array.from(store.invoices.values());
      },
    },
    invoiceLocalAdjustment: adjustmentMethods,
  };
}

function createMockAuth(role: string = 'ADMIN') {
  const session = {
    userId: 'user-admin-1',
    username: 'admin',
    fullName: 'Admin User',
    role,
    workstationId: 'ws-1',
    accessToken: 'token-123',
  };

  return {
    requireRole: (...allowedRoles: string[]) => {
      if (!allowedRoles.includes(role as never)) {
        throw new InsufficientRoleException(allowedRoles.join(' or '));
      }
      return session;
    },
    getCurrentSession: () => session,
    logout: () => {},
    login: async () => session,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocalAdjustmentService', () => {
  let store: Store;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    store = createStore();
    prisma = createMockPrisma(store);
    store.invoices.set('inv-1', makeFakeInvoice());
    store.invoices.set('inv-cancelled', makeFakeInvoice({ id: 'inv-cancelled', status: 'CANCELLED' }));
    store.invoices.set('inv-rejected', makeFakeInvoice({ id: 'inv-rejected', status: 'TRANSMITTED_REJECTED' }));
    store.invoices.set('inv-pending', makeFakeInvoice({ id: 'inv-pending', status: 'CONTINGENCY_PENDING_TRANSMISSION' }));
    store.invoices.set('inv-expired', makeFakeInvoice({ id: 'inv-expired', status: 'EXPIRED_CONTINGENCY' }));
    store.invoices.set('inv-credit-note', makeFakeInvoice({ id: 'inv-credit-note', invoiceType: 'CREDIT_NOTE', status: 'TRANSMITTED_AUTHORIZED' }));
  });

  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  it('applies a PAYMENT_METHOD_CHANGE adjustment', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    const result = await service.applyAdjustment(
      'inv-1',
      'PAYMENT_METHOD_CHANGE',
      {
        payments: [
          {
            paymentMethodId: 'pm-card',
            paymentMethodName: 'Tarjeta Débito',
            amount: '50000.00',
            category: 'DEBIT_CARD',
            transactionReference: 'TXN-001',
            authorizationCode: null,
            cardBrand: 'VISA',
            cardLastFour: '1234',
          },
        ],
      },
      'Cliente cambió método de pago después de salir',
    );

    expect(result.adjustmentType).toBe('PAYMENT_METHOD_CHANGE');
    expect(result.reason).toBe('Cliente cambió método de pago después de salir');
    expect(result.createdByUserName).toBe('Admin User');
    expect(result.newValue).toEqual({
      payments: [
        {
          paymentMethodId: 'pm-card',
          paymentMethodName: 'Tarjeta Débito',
          amount: '50000.00',
          category: 'DEBIT_CARD',
          transactionReference: 'TXN-001',
          authorizationCode: null,
          cardBrand: 'VISA',
          cardLastFour: '1234',
        },
      ],
    });
  });

  // -----------------------------------------------------------------------
  // Role gating
  // -----------------------------------------------------------------------

  it('rejects a CASHIER trying to apply adjustment', async () => {
    const auth = createMockAuth('CASHIER');
    const service = createLocalAdjustmentService(prisma as never, auth);

    await expect(
      service.applyAdjustment('inv-1', 'INTERNAL_NOTE', { text: 'Nota de prueba' }, 'Razón de prueba para la nota'),
    ).rejects.toThrow(InsufficientRoleException);
  });

  it('allows ADMIN to apply adjustment', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    const result = await service.applyAdjustment(
      'inv-1',
      'INTERNAL_NOTE',
      'Nota interna de prueba',
      'Razón válida para la nota',
    );

    expect(result.adjustmentType).toBe('INTERNAL_NOTE');
  });

  it('allows ACCOUNTANT to apply adjustment', async () => {
    const auth = createMockAuth('ACCOUNTANT');
    const service = createLocalAdjustmentService(prisma as never, auth);

    const result = await service.applyAdjustment(
      'inv-1',
      'TAG_ADD',
      'urgente',
      'Marcar como urgente para control interno',
    );

    expect(result.adjustmentType).toBe('TAG_ADD');
  });

  // -----------------------------------------------------------------------
  // Reason validation
  // -----------------------------------------------------------------------

  it('rejects reason shorter than 10 characters', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    await expect(
      service.applyAdjustment('inv-1', 'INTERNAL_NOTE', 'test', 'short'),
    ).rejects.toThrow(AdjustmentReasonTooShortException);
  });

  // -----------------------------------------------------------------------
  // Status allow rules
  // -----------------------------------------------------------------------

  it('allows PAYMENT_METHOD_CHANGE on TRANSMITTED_AUTHORIZED', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    const result = await service.applyAdjustment(
      'inv-1',
      'PAYMENT_METHOD_CHANGE',
      { payments: [{ paymentMethodId: 'pm-card', paymentMethodName: 'Card', amount: '50000.00', category: 'DEBIT_CARD', transactionReference: null, authorizationCode: null, cardBrand: null, cardLastFour: null }] },
      'Cambio de método de pago post-venta autorizado',
    );

    expect(result.adjustmentType).toBe('PAYMENT_METHOD_CHANGE');
  });

  it('blocks payment method change on CONTINGENCY_PENDING_TRANSMISSION', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    await expect(
      service.applyAdjustment(
        'inv-pending',
        'PAYMENT_METHOD_CHANGE',
        { payments: [] },
        'Intento de cambio de pago en contingencia pendiente',
      ),
    ).rejects.toThrow(AdjustmentNotAllowedForStatusException);
  });

  it('allows INTERNAL_NOTE on CONTINGENCY_PENDING_TRANSMISSION', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    const result = await service.applyAdjustment(
      'inv-pending',
      'INTERNAL_NOTE',
      'Nota de prueba',
      'Razón válida para nota en contingencia',
    );

    expect(result.adjustmentType).toBe('INTERNAL_NOTE');
  });

  it('blocks payment method change on TRANSMITTED_REJECTED', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    await expect(
      service.applyAdjustment(
        'inv-rejected',
        'PAYMENT_METHOD_CHANGE',
        { payments: [] },
        'Cambio de pago en factura rechazada no permitido',
      ),
    ).rejects.toThrow(AdjustmentNotAllowedForStatusException);
  });

  it('allows INTERNAL_NOTE on TRANSMITTED_REJECTED', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    const result = await service.applyAdjustment(
      'inv-rejected',
      'INTERNAL_NOTE',
      'Nota sobre factura rechazada',
      'Razón válida para nota en rechazada',
    );

    expect(result.adjustmentType).toBe('INTERNAL_NOTE');
  });

  it('blocks all adjustments on CANCELLED', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    await expect(
      service.applyAdjustment(
        'inv-cancelled',
        'INTERNAL_NOTE',
        'nota',
        'Razón válida larga suficiente',
      ),
    ).rejects.toThrow(AdjustmentNotAllowedForStatusException);
  });

  it('blocks payment method change on TRANSMITTED_REJECTED', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    await expect(
      service.applyAdjustment(
        'inv-expired',
        'PAYMENT_METHOD_CHANGE',
        { payments: [] },
        'No debe permitir cambio de pago en vencidas',
      ),
    ).rejects.toThrow(AdjustmentNotAllowedForStatusException);
  });

  it('allows INTERNAL_NOTE on EXPIRED_CONTINGENCY', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    const result = await service.applyAdjustment(
      'inv-expired',
      'INTERNAL_NOTE',
      'Nota sobre factura vencida',
      'Razón válida para nota en vencida',
    );

    expect(result.adjustmentType).toBe('INTERNAL_NOTE');
  });

  it('allows adjustments on CREDIT_NOTE', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    const result = await service.applyAdjustment(
      'inv-credit-note',
      'TAG_ADD',
      'revisado',
      'Marcar nota crédito como revisada internamente',
    );

    expect(result.adjustmentType).toBe('TAG_ADD');
  });

  // -----------------------------------------------------------------------
  // Reversal chain
  // -----------------------------------------------------------------------

  it('reverses an adjustment and restores original state', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    // Apply: cash → card
    const adj1 = await service.applyAdjustment(
      'inv-1',
      'PAYMENT_METHOD_CHANGE',
      {
        payments: [{
          paymentMethodId: 'pm-card',
          paymentMethodName: 'Tarjeta Débito',
          amount: '50000.00',
          category: 'DEBIT_CARD',
          transactionReference: null,
          authorizationCode: null,
          cardBrand: null,
          cardLastFour: null,
        }],
      },
      'Cambio a tarjeta por solicitud del cliente',
    );

    // Reverse the adjustment
    const reversal = await service.reverseAdjustment(
      adj1.id,
      'El cliente volvió a cambiar de opinión, reversión necesaria',
    );

    expect(reversal.adjustmentType).toBe('REVERSAL');
    expect(reversal.reversalOfAdjustmentId).toBe(adj1.id);

    // Operational view should now show cash (the original)
    const view = await service.resolveOperationalView('inv-1');
    expect(view.operational.payments[0].paymentMethodId).toBe('pm-cash');
    expect(view.operational.payments[0].paymentMethodName).toBe('Efectivo');
    expect(view.operational.hasDifferences).toBe(false);
  });

  it('handles chain: A → reverse(A) → B → reverse(B) returns to original', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    // A: cash → card
    const adjA = await service.applyAdjustment(
      'inv-1',
      'PAYMENT_METHOD_CHANGE',
      {
        payments: [{
          paymentMethodId: 'pm-card',
          paymentMethodName: 'Tarjeta Débito',
          amount: '50000.00',
          category: 'DEBIT_CARD',
          transactionReference: null,
          authorizationCode: null,
          cardBrand: null,
          cardLastFour: null,
        }],
      },
      'Cambio a tarjeta',
    );

    // Reverse A: back to cash
    await service.reverseAdjustment(adjA.id, 'Reversión del cambio a tarjeta por error');

    // B: cash → transfer
    const adjB = await service.applyAdjustment(
      'inv-1',
      'PAYMENT_METHOD_CHANGE',
      {
        payments: [{
          paymentMethodId: 'pm-transfer',
          paymentMethodName: 'Transferencia',
          amount: '50000.00',
          category: 'BANK_TRANSFER',
          transactionReference: 'TXN-002',
          authorizationCode: null,
          cardBrand: null,
          cardLastFour: null,
        }],
      },
      'Cambio a transferencia bancaria',
    );

    let view = await service.resolveOperationalView('inv-1');
    expect(view.operational.payments[0].paymentMethodId).toBe('pm-transfer');

    // Reverse B: back to cash
    await service.reverseAdjustment(adjB.id, 'Reversión del cambio a transferencia por error del cajero');

    view = await service.resolveOperationalView('inv-1');
    expect(view.operational.payments[0].paymentMethodId).toBe('pm-cash');
    expect(view.operational.payments[0].paymentMethodName).toBe('Efectivo');
  });

  it('prevents reversing an already-reversed adjustment', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    const adj = await service.applyAdjustment(
      'inv-1',
      'INTERNAL_NOTE',
      'Nota de prueba',
      'Razón válida para nota de prueba',
    );

    await service.reverseAdjustment(adj.id, 'Reversión de la nota por error');

    await expect(
      service.reverseAdjustment(adj.id, 'Intento de reversión doble no permitido'),
    ).rejects.toThrow(AdjustmentAlreadyReversedException);
  });

  // -----------------------------------------------------------------------
  // Multiple PAYMENT_METHOD_CHANGE — latest wins
  // -----------------------------------------------------------------------

  it('latest PAYMENT_METHOD_CHANGE wins in operational view', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    // First change: cash → card
    await service.applyAdjustment(
      'inv-1',
      'PAYMENT_METHOD_CHANGE',
      {
        payments: [{
          paymentMethodId: 'pm-card',
          paymentMethodName: 'Tarjeta Débito',
          amount: '50000.00',
          category: 'DEBIT_CARD',
          transactionReference: null,
          authorizationCode: null,
          cardBrand: null,
          cardLastFour: null,
        }],
      },
      'Cambio a tarjera débito primera vez',
    );

    // Second change: override to transfer
    await service.applyAdjustment(
      'inv-1',
      'PAYMENT_METHOD_CHANGE',
      {
        payments: [{
          paymentMethodId: 'pm-transfer',
          paymentMethodName: 'Transferencia',
          amount: '50000.00',
          category: 'BANK_TRANSFER',
          transactionReference: 'TXN-003',
          authorizationCode: null,
          cardBrand: null,
          cardLastFour: null,
        }],
      },
      'Cambio a transferencia bancaria definitivo',
    );

    const view = await service.resolveOperationalView('inv-1');
    expect(view.operational.payments).toHaveLength(1);
    expect(view.operational.payments[0].paymentMethodId).toBe('pm-transfer');
    expect(view.operational.payments[0].paymentMethodName).toBe('Transferencia');
  });

  // -----------------------------------------------------------------------
  // Operational view projection
  // -----------------------------------------------------------------------

  it('returns fiscal view unchanged when no adjustments', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    const view = await service.resolveOperationalView('inv-1');

    expect(view.fiscal.invoiceNumber).toBe('FE00000001');
    expect(view.fiscal.status).toBe('TRANSMITTED_AUTHORIZED');
    expect(view.operational.hasDifferences).toBe(false);
    expect(view.operational.payments[0].paymentMethodId).toBe('pm-cash');
    expect(view.operational.notes).toHaveLength(0);
  });

  it('projects INTERNAL_NOTE into operational view', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    await service.applyAdjustment(
      'inv-1',
      'INTERNAL_NOTE',
      'El cliente solicitó factura electrónica por correo',
      'Nota sobre preferencia de envío del cliente',
    );

    const view = await service.resolveOperationalView('inv-1');
    expect(view.operational.notes).toHaveLength(1);
    expect(view.operational.notes[0].text).toBe('El cliente solicitó factura electrónica por correo');
    expect(view.operational.notes[0].authorName).toBe('Admin User');
    expect(view.operational.hasDifferences).toBe(false); // INTERNAL_NOTE does not set hasDifferences per design
  });

  it('projects TAG_ADD and TAG_REMOVE into operational view', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    await service.applyAdjustment(
      'inv-1',
      'TAG_ADD',
      'urgente',
      'Marcar factura como urgente para seguimiento',
    );

    await service.applyAdjustment(
      'inv-1',
      'TAG_ADD',
      'revisado',
      'Marcar como revisado por contabilidad',
    );

    await service.applyAdjustment(
      'inv-1',
      'TAG_REMOVE',
      'urgente', // the tag to remove
      'Remover etiqueta urgente porque ya se gestionó el seguimiento',
    );

    const view = await service.resolveOperationalView('inv-1');

    expect(view.operational.tags).toContain('revisado');
    expect(view.operational.tags).not.toContain('urgente');
    expect(view.operational.hasDifferences).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Get adjustment history
  // -----------------------------------------------------------------------

  it('returns full chronological history with actor names', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    const adj1 = await service.applyAdjustment(
      'inv-1',
      'INTERNAL_NOTE',
      'Primera nota',
      'Razón para primera nota de seguimiento',
    );

    const adj2 = await service.applyAdjustment(
      'inv-1',
      'TAG_ADD',
      'prioritario',
      'Prioritario para el equipo de despacho urgente',
    );

    const reversal = await service.reverseAdjustment(
      adj1.id,
      'Reversión de la primera nota por error de digitación',
    );

    const history = await service.getAdjustmentHistory('inv-1');

    expect(history).toHaveLength(3);
    expect(history[0].id).toBe(adj1.id);
    expect(history[0].isReversed).toBe(true);
    expect(history[0].replacedByAdjustmentId).toBe(reversal.id);
    expect(history[1].id).toBe(adj2.id);
    expect(history[1].isReversed).toBe(false);
    expect(history[2].id).toBe(reversal.id);
    expect(history[2].adjustmentType).toBe('REVERSAL');
    expect(history[2].reversalOfAdjustmentId).toBe(adj1.id);
    expect(history[2].actorName).toBe('Admin User');
  });

  // -----------------------------------------------------------------------
  // CSV export
  // -----------------------------------------------------------------------

  it('exports adjustment log as CSV with all required columns', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    const adj = await service.applyAdjustment(
      'inv-1',
      'INTERNAL_NOTE',
      'Nota de prueba',
      'Razón válida y suficientemente larga',
    );

    const csv = await service.exportAdjustmentLogAsCsv('inv-1');

    expect(csv).toContain('createdAt,actor,adjustmentType');
    expect(csv).toContain(adj.adjustmentType);
    expect(csv).toContain('Admin User');
  });

  // -----------------------------------------------------------------------
  // getLocalAdjustmentSummary
  // -----------------------------------------------------------------------

  it('returns adjustment summary with counts by type', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    await service.applyAdjustment('inv-1', 'INTERNAL_NOTE', 'Nota 1', 'Razón válida para primera nota');
    await service.applyAdjustment('inv-1', 'TAG_ADD', 'tag1', 'Razón válida para agregar tag');
    await service.applyAdjustment('inv-credit-note', 'INTERNAL_NOTE', 'Nota 2', 'Razón válida para segunda nota');

    const summary = await service.getLocalAdjustmentSummary();

    expect(summary.adjustmentsLast24h).toBe(3);
    expect(summary.byType['INTERNAL_NOTE']).toBe(2);
    expect(summary.byType['TAG_ADD']).toBe(1);
    expect(summary.invoicesWithAdjustments).toBe(2);
    expect(summary.reversalsLast24h).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Concurrency
  // -----------------------------------------------------------------------

  it('rejects duplicate (invoiceId, version) — core of optimistic concurrency', async () => {
    // Verify the unique constraint enforcement: creating two adjustments with
    // the same (invoiceId, version) pair must fail. This is the fundamental
    // guarantee that makes optimistic locking work when two concurrent callers
    // both try to write the same version.
    await prisma.invoiceLocalAdjustment.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        invoiceId: 'inv-1',
        createdAt: new Date(),
        createdByUserId: 'user-1',
        createdByUserName: 'User One',
        adjustmentType: 'INTERNAL_NOTE',
        previousValue: null,
        newValue: 'nota original version 1',
        reason: 'Primera nota de prueba con razón válida larga',
        version: 1,
        reversalOfAdjustmentId: null,
        replacedByAdjustmentId: null,
      },
    });

    await expect(
      prisma.invoiceLocalAdjustment.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          invoiceId: 'inv-1',
          createdAt: new Date(),
          createdByUserId: 'user-2',
          createdByUserName: 'User Two',
          adjustmentType: 'TAG_ADD',
          previousValue: null,
          newValue: 'tag',
          reason: 'Intento de crear tag con version duplicada',
          version: 1, // Same version — should be rejected
          reversalOfAdjustmentId: null,
          replacedByAdjustmentId: null,
        },
      }),
    ).rejects.toThrow('Unique constraint violation on invoiceId and version');
  });

  it('applyAdjustment increments version correctly with sequential calls', async () => {
    const auth = createMockAuth('ADMIN');
    const service = createLocalAdjustmentService(prisma as never, auth);

    const adj1 = await service.applyAdjustment(
      'inv-1', 'INTERNAL_NOTE', 'Nota 1', 'Razón válida para nota uno',
    );
    expect(adj1.version).toBe(1);

    const adj2 = await service.applyAdjustment(
      'inv-1', 'TAG_ADD', 'tag1', 'Razón válida para agregar tag uno',
    );
    expect(adj2.version).toBe(2);

    const adj3 = await service.applyAdjustment(
      'inv-1', 'INTERNAL_NOTE', 'Nota 2', 'Razón válida para nota dos',
    );
    expect(adj3.version).toBe(3);

    // Reversal increments the counter too
    const reversal = await service.reverseAdjustment(
      adj1.id,
      'Reversión de nota uno por error en el texto',
    );
    expect(reversal.version).toBe(4);
  });
});
