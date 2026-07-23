/**
 * Local supplier-returns service for the offline-first POS.
 *
 * A supplier return records goods sent back to a supplier.  On confirmation,
 * stock is decremented from the relevant lots, inventory movements are
 * recorded, and a SyncQueue entry is created for server-side reconciliation
 * and DIAN credit-note generation.
 */
import {
  PrismaClient,
  Prisma,
  PurchaseReturnState,
  MovementType,
  SyncOperationType,
} from '@pharmacy/database/local';
import type { AuthService } from '../auth/auth.service';
import { RoleType } from '@pharmacy/shared-types';
import {
  SupplierNotFoundException,
  SupplierReturnNotFoundException,
  SupplierReturnNotDraftException,
  SupplierReturnCannotBeAnnulledException,
  SupplierReturnLotCostUnavailableException,
  PurchaseReceptionNotFoundException,
  LotNotFoundException,
  ConcurrentStockModificationException,
} from './exceptions';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CreateSupplierReturnItemInput {
  productId: string;
  lotId: string;
  quantity: number;
}

export interface CreateSupplierReturnInput {
  supplierId: string;
  /** Optional purchase reception this return references. */
  purchaseReceptionId?: string;
  reason?: string;
  items: CreateSupplierReturnItemInput[];
}

export interface SupplierReturnItemResult {
  id: string;
  productId: string;
  lotId: string;
  quantity: number;
  unitCost: number;
  totalAmount: number;
}

export interface SupplierReturnResult {
  id: string;
  sequentialNumber: number;
  state: string;
  supplierId: string;
  supplier: { id: string; businessName: string };
  purchaseReceptionId: string | null;
  reason: string | null;
  notes: string | null;
  subtotal: number;
  totalTax: number;
  totalAmount: number;
  createdAt: string;
  createdById: string;
  items: SupplierReturnItemResult[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSupplierReturnsService = (
  prisma: PrismaClient,
  auth: AuthService,
): SupplierReturnsService => {
  return new SupplierReturnsService(prisma, auth);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SupplierReturnsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
  ) {}

  /**
   * List supplier returns with optional filters.
   */
  async listReturns(params?: {
    supplierId?: string;
    state?: PurchaseReturnState;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: SupplierReturnResult[]; total: number }> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 50;

    const where: Prisma.SupplierReturnWhereInput = {};
    if (params?.supplierId) where.supplierId = params.supplierId;
    if (params?.state) where.state = params.state;

    const [returns, total] = await this.prisma.$transaction([
      this.prisma.supplierReturn.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          supplier: { select: { id: true, businessName: true } },
          items: true,
        },
      }),
      this.prisma.supplierReturn.count({ where }),
    ]);

    return {
      data: returns.map((r) => this.mapReturn(r, r.items)),
      total,
    };
  }

  /**
   * Get a single supplier return by ID.
   * @throws SupplierReturnNotFoundException
   */
  async getReturn(id: string): Promise<SupplierReturnResult> {
    const supplierReturn = await this.prisma.supplierReturn.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, businessName: true } },
        items: true,
      },
    });
    if (!supplierReturn) throw new SupplierReturnNotFoundException(id);
    return this.mapReturn(supplierReturn, supplierReturn.items);
  }

  /**
   * Create a supplier return in DRAFT state.
   * Stock is NOT modified at this stage — that happens on confirm().
   *
   * Requires INVENTORY_ASSISTANT or ADMIN role.
   */
  async createReturn(input: CreateSupplierReturnInput): Promise<SupplierReturnResult> {
    const session = this.auth.requireRole(
      RoleType.INVENTORY_ASSISTANT,
      RoleType.ADMIN,
    );

    return this.prisma.$transaction(async (tx) => {
      // Validate supplier
      const supplier = await tx.supplier.findUnique({
        where: { id: input.supplierId },
        select: { id: true, businessName: true },
      });
      if (!supplier) throw new SupplierNotFoundException(input.supplierId);

      // Validate purchase reception if provided
      if (input.purchaseReceptionId) {
        const reception = await tx.purchaseReception.findUnique({
          where: { id: input.purchaseReceptionId },
          select: { id: true },
        });
        if (!reception) {
          throw new PurchaseReceptionNotFoundException(input.purchaseReceptionId);
        }
      }

      // Build items with unit cost lookup
      const itemsData: Array<{
        id: string;
        productId: string;
        lotId: string;
        quantity: number;
        unitCost: Prisma.Decimal;
        totalAmount: Prisma.Decimal;
      }> = [];

      for (const item of input.items) {
        // Validate lot exists
        const lot = await tx.lot.findUnique({
          where: { id: item.lotId },
          select: { id: true, productId: true },
        });
        if (!lot) throw new LotNotFoundException(item.lotId);

        // Look up unit cost from purchase reception item
        const receptionItem = await tx.purchaseReceptionItem.findFirst({
          where: { lotId: item.lotId },
          select: { realUnitCost: true },
        });
        if (!receptionItem) {
          throw new SupplierReturnLotCostUnavailableException(item.lotId);
        }

        const unitCost = receptionItem.realUnitCost;
        itemsData.push({
          id: globalThis.crypto.randomUUID(),
          productId: item.productId,
          lotId: item.lotId,
          quantity: item.quantity,
          unitCost,
          totalAmount: new Prisma.Decimal(item.quantity).times(unitCost),
        });
      }

      const subtotal = itemsData.reduce(
        (sum, it) => sum.plus(it.totalAmount),
        new Prisma.Decimal(0),
      );
      const sequentialNumber = await this.getNextSequentialNumber(tx);

      const supplierReturn = await tx.supplierReturn.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          sequentialNumber,
          state: PurchaseReturnState.DRAFT,
          supplierId: input.supplierId,
          purchaseReceptionId: input.purchaseReceptionId ?? null,
          reason: input.reason ?? null,
          subtotal,
          totalTax: new Prisma.Decimal(0),
          totalAmount: subtotal,
          createdById: session.userId,
          items: { create: itemsData },
        },
        include: {
          supplier: { select: { id: true, businessName: true } },
          items: true,
        },
      });

      return this.mapReturn(supplierReturn, supplierReturn.items);
    });
  }

  /**
   * Confirm a DRAFT supplier return — decrements stock from lots and
   * creates a SyncQueue entry for server-side reconciliation.
   *
   * Requires INVENTORY_ASSISTANT or ADMIN role.
   *
   * @throws SupplierReturnNotFoundException
   * @throws SupplierReturnNotDraftException
   * @throws ConcurrentStockModificationException
   */
  async confirmReturn(id: string): Promise<SupplierReturnResult> {
    const session = this.auth.requireRole(
      RoleType.INVENTORY_ASSISTANT,
      RoleType.ADMIN,
    );

    return this.prisma.$transaction(async (tx) => {
      const supplierReturn = await tx.supplierReturn.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!supplierReturn) throw new SupplierReturnNotFoundException(id);
      if (supplierReturn.state !== PurchaseReturnState.DRAFT) {
        throw new SupplierReturnNotDraftException(id, 'DRAFT');
      }

      // Decrement stock for each item
      for (const item of supplierReturn.items) {
        const lot = await tx.lot.findUnique({
          where: { id: item.lotId },
          select: { id: true, currentStock: true, version: true, state: true },
        });
        if (!lot) throw new LotNotFoundException(item.lotId);
        if (lot.currentStock < item.quantity) {
          throw new Error(
            `Insufficient stock for lot ${item.lotId}: ` +
            `available ${lot.currentStock}, requested ${item.quantity}.`,
          );
        }

        const newStock = lot.currentStock - item.quantity;
        const newVersion = lot.version + 1;

        const updated = await tx.lot.updateMany({
          where: { id: lot.id, version: lot.version },
          data: {
            currentStock: newStock,
            version: newVersion,
            state: newStock === 0 ? 'EXHAUSTED' : lot.state,
          },
        });
        if (updated.count === 0) {
          throw new ConcurrentStockModificationException(lot.id);
        }

        await tx.inventoryMovement.create({
          data: {
            id: globalThis.crypto.randomUUID(),
            lotId: lot.id,
            movementType: MovementType.SUPPLIER_RETURN,
            quantity: item.quantity,
            previousStock: lot.currentStock,
            resultingStock: newStock,
            createdById: session.userId,
            createdAt: new Date(),
            supplierReturnId: supplierReturn.id,
            reason: supplierReturn.reason,
          },
        });
      }

      // Transition to CONFIRMED
      const updated = await tx.supplierReturn.update({
        where: { id },
        data: { state: PurchaseReturnState.CONFIRMED },
        include: {
          supplier: { select: { id: true, businessName: true } },
          items: true,
        },
      });

      // Create SyncQueue entry
      await this.createSyncQueueEntry(tx, supplierReturn, session);

      return this.mapReturn(updated, updated.items);
    });
  }

  /**
   * Approve a CONFIRMED supplier return — transitions to APPROVED.
   * Requires ADMIN role.
   */
  async approveReturn(id: string): Promise<SupplierReturnResult> {
    this.auth.requireRole(RoleType.ADMIN);

    return this.prisma.$transaction(async (tx) => {
      const supplierReturn = await tx.supplierReturn.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!supplierReturn) throw new SupplierReturnNotFoundException(id);
      if (supplierReturn.state !== PurchaseReturnState.CONFIRMED) {
        throw new SupplierReturnNotDraftException(id, 'CONFIRMED');
      }

      const updated = await tx.supplierReturn.update({
        where: { id },
        data: { state: PurchaseReturnState.APPROVED },
        include: {
          supplier: { select: { id: true, businessName: true } },
          items: true,
        },
      });

      return this.mapReturn(updated, updated.items);
    });
  }

  /**
   * Annul a DRAFT supplier return.
   * Requires ADMIN role.
   */
  async annulReturn(id: string): Promise<SupplierReturnResult> {
    this.auth.requireRole(RoleType.ADMIN);

    return this.prisma.$transaction(async (tx) => {
      const supplierReturn = await tx.supplierReturn.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!supplierReturn) throw new SupplierReturnNotFoundException(id);
      if (supplierReturn.state !== PurchaseReturnState.DRAFT) {
        throw new SupplierReturnCannotBeAnnulledException(id);
      }

      const updated = await tx.supplierReturn.update({
        where: { id },
        data: { state: PurchaseReturnState.ANNULLED },
        include: {
          supplier: { select: { id: true, businessName: true } },
          items: true,
        },
      });

      return this.mapReturn(updated, updated.items);
    });
  }

  // ---------------------------------------------------------------------------
  // Private — sync
  // ---------------------------------------------------------------------------

  private async createSyncQueueEntry(
    tx: Prisma.TransactionClient,
    supplierReturn: {
      id: string;
      sequentialNumber: number;
      supplierId: string;
      purchaseReceptionId: string | null;
      reason: string | null;
    },
    session: { userId: string; workstationId: string },
  ): Promise<void> {
    const payload = JSON.stringify({
      operationType: 'SUPPLIER_RETURN_CONFIRMATION',
      returnId: supplierReturn.id,
      sequentialNumber: supplierReturn.sequentialNumber,
      supplierId: supplierReturn.supplierId,
      purchaseReceptionId: supplierReturn.purchaseReceptionId,
      reason: supplierReturn.reason,
      createdByUserId: session.userId,
      workstationId: session.workstationId,
      confirmedAt: new Date().toISOString(),
    });

    const payloadBytes = new TextEncoder().encode(payload);
    const latestSeq = await tx.syncQueue.findFirst({
      where: { sourceWorkstationId: session.workstationId },
      orderBy: { clientSequence: 'desc' },
      select: { clientSequence: true },
    });
    const clientSequence = latestSeq ? latestSeq.clientSequence + 1n : 1n;

    await tx.syncQueue.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        operationUuid: globalThis.crypto.randomUUID(),
        operationType: SyncOperationType.SUPPLIER_RETURN_CONFIRMATION,
        payload,
        payloadHash: await this.computeHash(payload),
        payloadSize: payloadBytes.length,
        versionSchema: 1,
        status: 'PENDING',
        retryCount: 0,
        sourceWorkstationId: session.workstationId,
        sourceCreatedAt: new Date(),
        clientSequence,
      },
    });
  }

  private async computeHash(payload: string): Promise<string> {
    const data = new TextEncoder().encode(payload);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------------------------------------------------------------------------
  // Private — helpers
  // ---------------------------------------------------------------------------

  private async getNextSequentialNumber(
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const latest = await tx.supplierReturn.findFirst({
      orderBy: { sequentialNumber: 'desc' },
      select: { sequentialNumber: true },
    });
    return (latest?.sequentialNumber ?? 0) + 1;
  }

  private mapReturn(
    supplierReturn: {
      id: string;
      sequentialNumber: number;
      state: string;
      supplierId: string;
      supplier: { id: string; businessName: string };
      purchaseReceptionId: string | null;
      reason: string | null;
      notes: string | null;
      subtotal: Prisma.Decimal;
      totalTax: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
      createdAt: Date;
      createdById: string;
    },
    items: Array<{
      id: string;
      productId: string;
      lotId: string;
      quantity: number;
      unitCost: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
    }>,
  ): SupplierReturnResult {
    return {
      id: supplierReturn.id,
      sequentialNumber: supplierReturn.sequentialNumber,
      state: supplierReturn.state,
      supplierId: supplierReturn.supplierId,
      supplier: supplierReturn.supplier,
      purchaseReceptionId: supplierReturn.purchaseReceptionId,
      reason: supplierReturn.reason,
      notes: supplierReturn.notes,
      subtotal: Number(supplierReturn.subtotal),
      totalTax: Number(supplierReturn.totalTax),
      totalAmount: Number(supplierReturn.totalAmount),
      createdAt: supplierReturn.createdAt.toISOString(),
      createdById: supplierReturn.createdById,
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        lotId: item.lotId,
        quantity: item.quantity,
        unitCost: Number(item.unitCost),
        totalAmount: Number(item.totalAmount),
      })),
    };
  }
}
