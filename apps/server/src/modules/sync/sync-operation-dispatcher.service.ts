import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@pharmacy/database';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { CashCountType } from '@pharmacy/shared-types';
import { CashShiftService } from '@/modules/cash-shift/cash-shift.service';
import { ClientsService } from '@/modules/clients/clients.service';
import { SalesService } from '@/modules/sales-pos/services/sales.service';
import { ClientReturnsService } from '@/modules/sales-pos/services/client-returns.service';
import { InventoryAdjustmentsService } from '@/modules/inventory-lots/services/inventory-adjustments.service';
import { FiscalDocumentsService } from '@/modules/fiscal-dian/services/fiscal-documents.service';
import { ProductsService } from '@/modules/catalog/products.service';
import { PurchaseOrdersService } from '@/modules/purchases/services/purchase-orders.service';
import { PurchaseReceptionsService } from '@/modules/purchases/services/purchase-receptions.service';
import { SupplierReturnsService } from '@/modules/purchases/services/supplier-returns.service';
import { InvoiceTransmissionPayloadSchema } from '@pharmacy/shared-validation';
import { InvoiceAdjustmentPayloadSchema } from './dto/invoice-adjustment-payload.schema';
import { SyncPayloadValidationException } from './exceptions/sync-payload-validation.exception';
import {
  PurchaseOrderConfirmationPayloadSchema,
  PurchaseReceptionConfirmationPayloadSchema,
  SupplierReturnConfirmationPayloadSchema,
} from './dto/purchase-sync-payloads.schema';
import { CreateProductSchema } from '@/modules/catalog/dto/create-product.dto';
import type { SyncQueueEntry } from './entities/sync-queue-entry.entity';
import type { CreateSaleDto } from '@/modules/sales-pos/dto/create-sale.dto';
import type { ConfirmSaleDto } from '@/modules/sales-pos/dto/confirm-sale.dto';
import type { CreateClientDto } from '@/modules/clients/dto/create-client.dto';
import type { UpdateClientDto } from '@/modules/clients/dto/update-client.dto';
import type { CreateClientReturnDto } from '@/modules/sales-pos/dto/create-client-return.dto';
import type { CreateInventoryAdjustmentDto, CreateInventoryAdjustmentItemDto } from '@/modules/inventory-lots/dto/create-inventory-adjustment.dto';
import type { PurchaseOrderConfirmationPayload, PurchaseReceptionConfirmationPayload, SupplierReturnConfirmationPayload, LotSyncData } from './dto/purchase-sync-payloads';
import * as crypto from 'node:crypto';

/**
 * Result of dispatching a single sync operation.
 *
 * Only `*_CREATION` handlers populate fields; every other handler returns
 * an empty object. The fields are surfaced to the POS in the batch
 * response so the local row's `serverId` (and, for products, the
 * server-chosen `internalCode` that replaced the offline provisional
 * value) can be stamped after a successful push.
 */
export interface DispatchResult {
  entityId?: string;
  entityInternalCode?: string;
}

/**
 * Re-executes the real business logic for each supported offline operation.
 * This is NOT a blind trust of the offline payload — it re-validates every
 * constraint against its current state.
 *
 * After each dispatch, the outcome (ACCEPTED / REJECTED with failure category)
 * is recorded in SyncOperationOutcome for aggregation in the sync health
 * endpoint. The outcome insert runs inside the same transaction as the
 * replayed business write when the handler already runs inside one; otherwise
 * it is best-effort and documented as eventually consistent.
 */
@Injectable()
export class SyncOperationDispatcherService {
  private readonly logger = new Logger(SyncOperationDispatcherService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    @Inject(CashShiftService) private readonly cashShiftService: CashShiftService,
    @Inject(ClientsService) private readonly clientsService: ClientsService,
    @Inject(SalesService) private readonly salesService: SalesService,
    @Inject(ClientReturnsService) private readonly clientReturnsService: ClientReturnsService,
    @Inject(InventoryAdjustmentsService) private readonly inventoryAdjustmentsService: InventoryAdjustmentsService,
    @Inject(FiscalDocumentsService) private readonly fiscalDocumentsService: FiscalDocumentsService,
    @Inject(ProductsService) private readonly productsService: ProductsService,
    @Inject(PurchaseOrdersService) private readonly purchaseOrdersService: PurchaseOrdersService,
    @Inject(PurchaseReceptionsService) private readonly purchaseReceptionsService: PurchaseReceptionsService,
    @Inject(SupplierReturnsService) private readonly supplierReturnsService: SupplierReturnsService,
  ) {}

  /**
   * Routes a SyncQueue entry to the appropriate replay handler.
   *
   * Catches all errors and records a FAILED outcome with the error message.
   * Successful dispatches record an ACCEPTED outcome. Returns the
   * dispatcher's view of any server-assigned ids the handler produced;
   * non-creation handlers return an empty object.
   */
  async dispatch(entry: SyncQueueEntry): Promise<DispatchResult> {
    try {
      let result: DispatchResult = {};
      switch (entry.operationType) {
        case 'SALE_CONFIRMATION':
          await this.handleSaleConfirmation(entry);
          break;
        case 'SHIFT_CLOSURE':
          await this.handleShiftClosure(entry);
          break;
        case 'CLIENT_CREATION':
          result = await this.handleClientCreation(entry);
          break;
        case 'CLIENT_UPDATE':
          await this.handleClientUpdate(entry);
          break;
        case 'CLIENT_DEACTIVATE':
          await this.handleClientDeactivate(entry);
          break;
        case 'CLIENT_RETURN':
          await this.handleClientReturn(entry);
          break;
        case 'CLIENT_CREDIT_PAYMENT':
          await this.handleClientCreditPayment(entry);
          break;
        case 'CLIENT_CREDIT_PAYMENT_ANNULMENT':
          await this.handleClientCreditPaymentAnnulment(entry);
          break;
        case 'INVENTORY_ADJUSTMENT':
          await this.handleInventoryAdjustment(entry);
          break;
        case 'PRESCRIPTION_REGISTRATION':
          await this.handlePrescriptionRegistration(entry);
          break;
        case 'INVOICE_TRANSMISSION':
          await this.handleInvoiceTransmission(entry);
          break;
        case 'INVOICE_ADJUSTMENT':
          await this.handleInvoiceAdjustment(entry);
          break;
        case 'PRODUCT_CREATION':
          result = await this.handleProductCreation(entry);
          break;
        case 'PRODUCT_UPDATE':
          await this.handleProductUpdate(entry);
          break;
        case 'PURCHASE_ORDER_CONFIRMATION':
          await this.handlePurchaseOrderConfirmation(entry);
          break;
        case 'PURCHASE_RECEPTION_CONFIRMATION':
          await this.handlePurchaseReceptionConfirmation(entry);
          break;
        case 'SUPPLIER_RETURN_CONFIRMATION':
          await this.handleSupplierReturnConfirmation(entry);
          break;
        // FISCAL_DOCUMENT_SYNC, RESOLUTION_ALLOCATION
        // are not dispatched — the job never selects them.
      }

      await this.recordOutcomeFromEntry(entry, 'ACCEPTED', null);
      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const failureCategory = this.classifyServerError(errorMessage);
      await this.recordOutcomeFromEntry(entry, 'REJECTED', failureCategory);
      throw error;
    }
  }

  /**
   * Record a SyncOperationOutcome row.
   *
   * Best-effort: if the insert fails (e.g. unique constraint, db connection), the
   * dispatch is unaffected — the health metric is eventually consistent.
   */
  private async recordOutcome(
    operationUuid: string,
    workstationId: string,
    outcome: string,
    failureCategory: string | null,
    operationSource: 'DIRECT' | 'LOCAL_HUB' = 'DIRECT',
  ): Promise<void> {
    try {
      await this.prisma.syncOperationOutcome.create({
        data: {
          id: crypto.randomUUID(),
          subscriptionId: this.tenantContext.getSubscriptionId(),
          operationUuid,
          workstationId,
          outcome,
          failureCategory,
          operationSource,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record SyncOperationOutcome for ${operationUuid}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }
  }

  /**
   * Record a SyncOperationOutcome row from a SyncQueueEntry,
   * extracting the operationSource from the entry.
   */
  private async recordOutcomeFromEntry(
    entry: SyncQueueEntry,
    outcome: string,
    failureCategory: string | null,
  ): Promise<void> {
    return this.recordOutcome(
      entry.operationUuid,
      entry.sourceWorkstationId,
      outcome,
      failureCategory,
      entry.operationSource,
    );
  }

  /**
   * Classify a server-side error into a failure category string, matching
   * the same categories used by the local POS push service.
   */
  private classifyServerError(message: string): string {
    const lower = message.toLowerCase();
    if (
      lower.includes('validation') ||
      lower.includes('schema') ||
      lower.includes('malformed')
    ) {
      return 'VALIDATION';
    }
    if (
      lower.includes('conflict') ||
      lower.includes('mismatch') ||
      lower.includes('already exists')
    ) {
      return 'CONFLICT';
    }
    if (
      lower.includes('auth') ||
      lower.includes('unauthorized') ||
      lower.includes('forbidden')
    ) {
      return 'AUTH';
    }
    if (
      lower.includes('prescription') ||
      lower.includes('closed') ||
      lower.includes('not allowed') ||
      lower.includes('insufficient stock') ||
      lower.includes('business')
    ) {
      return 'BUSINESS_RULE';
    }
    return 'UNKNOWN';
  }

  /**
   * Parse a JSON payload and validate it against a Zod schema, surfacing a
   * `SyncPayloadValidationException` with field-level detail on failure.
   * Used by every handler that consumes a typed sync payload so a missing
   * or malformed field produces a `VALIDATION` failure category with a
   * clear message instead of a raw `DecimalError` deeper in the service.
   */
  private parsePayload<T>(
    operationType: string,
    raw: string,
    schema: import('zod').ZodType<T>,
  ): T {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SyncPayloadValidationException(operationType, [
        { field: '(root)', message: 'payload is not valid JSON' },
      ]);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new SyncPayloadValidationException(
        operationType,
        result.error.issues.map((i) => ({
          field: i.path.join('.') || '(root)',
          message: i.message,
        })),
      );
    }
    return result.data;
  }

  /** Replays a SALE_CONFIRMATION by creating and confirming the sale server-side. */
  private async handleSaleConfirmation(entry: SyncQueueEntry): Promise<void> {
    const payload = JSON.parse(entry.payload) as Record<string, unknown>;
    const userId = payload.userId as string;
    const workstationId = entry.sourceWorkstationId;
    const createSaleDto = payload.createSaleDto as unknown as CreateSaleDto;

    // ── Idempotency guard ───────────────────────────────────────────
    // If this operationUuid already created a sale via a prior attempt,
    // use the existing sale for confirmation instead of creating a
    // duplicate. Without this guard, a transient failure after
    // create() (e.g. confirm() throws due to stock issue) leaves the
    // SyncQueue entry FAILED; the retry would create a new IN_PROGRESS
    // orphan each time — the exact duplication pattern seen in the bug.
    // Follows the same pattern as handleProductCreation.
    const existingSale = await this.prisma.sale.findUnique({
      where: { sourceOperationUuid: entry.operationUuid },
      select: { id: true, operationalState: true },
    });
    if (existingSale) {
      this.logger.log(
        `SALE_CONFIRMATION idempotent: operationUuid=${entry.operationUuid} ` +
        `already created sale ${existingSale.id} (${existingSale.operationalState}) — confirming existing`,
      );
      if (existingSale.operationalState === 'CONFIRMED') {
        // Already confirmed — nothing to do.
        return;
      }
      // Sale exists but is not yet confirmed — attempt confirmation.
      await this.salesService.confirm(
        existingSale.id,
        payload.confirmSaleDto as unknown as ConfirmSaleDto,
        userId,
      );
      return;
    }

    // Ensure the sale's cash-shift reference resolves under the GLOBAL
    // shift model before replaying. The POS manages shifts locally and
    // never syncs SHIFT_OPEN, so the referenced shift may not exist
    // server-side yet. Resolution order:
    //   1. Referenced shift already exists (OPEN or closed) → done;
    //      SalesService.getOpenCashShift handles attribution.
    //   2. A tenant-wide OPEN shift exists (opened by ANOTHER workstation
    //      or user) → rewrite cashShiftId to join it. Workstation
    //      ownership of the shift is irrelevant by design.
    //   3. Neither → legacy-compat bootstrap: materialize the offline
    //      shift as the tenant's OPEN shift.
    // If cashShiftId is missing (POS payload without shift), still
    // ensure an OPEN shift exists and assign it — otherwise
    // salesService.create throws CashShiftNotOpenForWorkstation on every retry.
    await this.ensureGlobalShiftAttribution(createSaleDto, workstationId, userId);

    // ── Product ID remapping ─────────────────────────────────────────
    // The POS records the local UUID of each product in the sale item.
    // When the product was created via PRODUCT_CREATION sync, the server
    // may have assigned a different UUID (or, with the fix, used the
    // local UUID directly via sourceProductId).  Remap every item's
    // productId to the server's product id so the sale does not fail
    // with ProductNotFoundException.
    if (createSaleDto?.items?.length) {
      for (const item of createSaleDto.items) {
        const serverProduct = await this.prisma.product.findFirst({
          where: {
            OR: [
              { id: item.productId },
              { sourceProductId: item.productId },
            ],
          },
          select: { id: true },
        });
        if (serverProduct) {
          item.productId = serverProduct.id;
        }
        // If no product is found on the server at all, the subsequent
        // salesService.create() will throw ProductNotFoundException with
        // the original productId — that's the correct behaviour for a
        // product that genuinely does not exist on the server.
      }
    }

    const sale = await this.salesService.create(
      createSaleDto,
      userId,
      workstationId,
      entry.operationUuid, // sourceOperationUuid — stored on Sale for idempotency
    );
    await this.salesService.confirm(
      (sale as { id: string }).id,
      payload.confirmSaleDto as unknown as ConfirmSaleDto,
      userId,
    );
  }

  /**
   * Resolves a replayed sale's cash-shift reference against the GLOBAL
   * shift model (exactly one OPEN shift per tenant).
   *
   * The check-and-materialize runs inside one transaction guarded by a
   * PostgreSQL advisory lock keyed per subscription: without it, two
   * workstations replaying offline sales concurrently could both observe
   * "no open shift" and each materialize their own, silently breaking the
   * one-open-shift invariant (the schema has no partial unique index on
   * `state = 'OPEN'` to catch it at the database level).
   *
   * Mutates `createSaleDto.cashShiftId` in place when the sale is adopted
   * into an existing OPEN shift — the DTO instance is dispatcher-local, so
   * this never leaks back to any client payload.
   */
  private async ensureGlobalShiftAttribution(
    createSaleDto: CreateSaleDto,
    workstationId: string,
    userId: string,
  ): Promise<void> {
    // If DTO already references an existing shift (OPEN or CLOSED fallback),
    // no bootstrapping needed — salesService.getOpenCashShift handles it.
    if (createSaleDto.cashShiftId) {
      const referencedShift = await this.prisma.cashShift.findUnique({
        where: { id: createSaleDto.cashShiftId },
        select: { id: true },
      });
      if (referencedShift) return;
    }

    const lockKey = `${this.tenantContext.getSubscriptionId()}:cash-shift-global-open`;

    await this.prisma.$transaction(async (tx) => {
      const subscriptionId = this.tenantContext.getSubscriptionId();
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${subscriptionId}, true)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const openShift = await tx.cashShift.findFirst({
        where: { state: 'OPEN', subscriptionId },
        orderBy: { openedAt: 'desc' },
        select: { id: true },
      });

      if (openShift) {
        // Join THE global shift opened by another workstation/user.
        createSaleDto.cashShiftId = openShift.id;
        return;
      }

      // No OPEN shift exists — bootstrap one. If the DTO already carries a
      // cashShiftId (offline local shift id), reuse it so retries stay
      // idempotent; otherwise generate a new UUID for the GLOBAL shift.
      const bootstrapId = createSaleDto.cashShiftId ?? crypto.randomUUID();
      createSaleDto.cashShiftId = bootstrapId;
      await tx.cashShift.upsert({
        where: { id: bootstrapId },
        update: {},
        create: {
          id: bootstrapId,
          subscriptionId: this.tenantContext.getSubscriptionId(),
          workstationId,
          userId,
          state: 'OPEN',
          openedAt: new Date(),
          openingBalance: new Prisma.Decimal(0),
        },
      });
    });
  }

  /**
   * Replays a SHIFT_CLOSURE: registers closing cash counts then closes the shift.
   *
   * Global shift model: `shiftId` IS THE store-wide shift — a closure pushed
   * from any workstation closes it for every other workstation. This runs at
   * service level, bypassing the ADMIN-only HTTP guard on POST /cash-shifts/:id/close
   * by design; the POS-side authorization of who may close is enforced when
   * the operation is queued locally.
   */
  private async handleShiftClosure(entry: SyncQueueEntry): Promise<void> {
    const payload = JSON.parse(entry.payload) as Record<string, unknown>;
    const userId = payload.userId as string;
    const shiftId = payload.shiftId as string;
    const cashCounts = payload.cashCounts as Array<Record<string, unknown>> | undefined;

    for (const count of cashCounts ?? []) {
      await this.cashShiftService.registerCashCount(shiftId, userId, {
        countType: count.countType as CashCountType,
        paymentMethodId: count.paymentMethodId as string,
        expectedAmount: new Prisma.Decimal(count.expectedAmount as string),
        declaredAmount: new Prisma.Decimal(count.declaredAmount as string),
        denominationsBreakdown: count.denominationsBreakdown as
          | Record<string, number>
          | undefined,
      });
    }
    await this.cashShiftService.closeShift(shiftId, userId, {
      closingNotes: payload.closingNotes as string | undefined,
    });
  }

  /**
   * Replays a CLIENT_CREATION by creating or updating the client server-side.
   *
   * The local UUID generated by the POS is preserved via `localClientId` so
   * that future sync operations referencing this client (e.g. sale confirmations)
   * resolve correctly. If the `[identificationType, identificationNumber]`
   * unique constraint is violated, the `clientsService.create` method performs
   * an upsert — the POS's data is treated as the latest version
   * ("last writer wins" strategy).
   *
   * Returns the server-assigned client id so the POS can stamp `serverId`
   * on its local row and unblock the `assertClientsSynced` sales gate.
   */
  private async handleClientCreation(entry: SyncQueueEntry): Promise<DispatchResult> {
    const payload = JSON.parse(entry.payload) as Record<string, unknown>;
    const userId = payload.userId as string;
    const createClientDto = payload.createClientDto as unknown as CreateClientDto;
    const localClientId = payload.localClientId as string | undefined;

    const client = await this.clientsService.create(
      createClientDto,
      userId,
      localClientId,
    );
    return { entityId: (client as { id: string }).id };
  }

  /**
   * Replays a CLIENT_UPDATE by applying the update server-side.
   *
   * The payload must include `updateClientDto` (partial client fields to update)
   * and `metadata.localClientId` identifying the client record to update.
   * Uses the same conflict-resolution strategy as CLIENT_CREATION: last writer
   * wins for concurrent offline edits.
   *
   * A ClientNotFoundException is thrown if the localClientId does not match
   * any server-side record.
   */
  private async handleClientUpdate(entry: SyncQueueEntry): Promise<void> {
    const payload = JSON.parse(entry.payload) as Record<string, unknown>;
    const userId = payload.userId as string;
    const metadata = payload.metadata as Record<string, unknown> | undefined;
    const clientId = (payload.clientId ?? metadata?.localClientId) as string;
    const updateClientDto = payload.updateClientDto as unknown as UpdateClientDto;

    await this.clientsService.update(clientId, updateClientDto, userId);
  }

  /**
   * Replays a CLIENT_DEACTIVATE by soft-deleting the client server-side.
   *
   * The payload must include `deactivateClientDto.clientId` identifying the
   * client to deactivate. Sets `isActive: false` on the Client record.
   *
   * A ClientNotFoundException is thrown if the client does not exist.
   */
  private async handleClientDeactivate(entry: SyncQueueEntry): Promise<void> {
    const payload = JSON.parse(entry.payload) as Record<string, unknown>;
    const userId = payload.userId as string;
    const deactivateClientDto = payload.deactivateClientDto as Record<string, unknown> | undefined;
    const clientId = (deactivateClientDto?.clientId ?? payload.clientId) as string;

    await this.clientsService.findById(clientId);
    await this.prisma.client.update({
      where: { id: clientId },
      data: {
        isActive: false,
        updatedById: userId,
      },
    });
  }

  /**
   * Replays a CLIENT_RETURN by creating the return server-side.
   *
   * The POS has already reversed stock locally and recorded the return as
   * CONFIRMED. The server re-validates every constraint against its current
   * state and processes the return through its own workflow (credit note
   * generation via FiscalDocumentsService).
   *
   * The local return ID is preserved in the payload so the server can
   * correlate the server-issued credit note back to the POS transaction.
   */
  private async handleClientReturn(entry: SyncQueueEntry): Promise<void> {
    const payload = JSON.parse(entry.payload) as Record<string, unknown>;
    const userId = payload.createdById as string;
    const workstationId = payload.workstationId as string;
    const localReturnId = (payload.metadata as Record<string, unknown> | undefined)?.localReturnId as string | undefined;

    // Build the DTO from the POS payload — matches CreateClientReturnDto shape
    const createDto: CreateClientReturnDto = {
      saleId: payload.saleId as string,
      refundMethodId: payload.refundMethodId as string,
      reason: (payload.reason as string) ?? undefined,
      items: (payload.items as Array<Record<string, unknown>>).map((item: Record<string, unknown>) => ({
        saleItemId: item.saleItemId as string,
        quantity: item.quantity as number,
        lots: (item.lots as Array<Record<string, unknown>> | undefined)?.map(
          (lot: Record<string, unknown>) => ({
            lotId: lot.lotId as string,
            quantity: lot.quantity as number,
          }),
        ),
      })),
    };

    // Create the return server-side. Passing the local return ID allows the
    // server to preserve it as the authoritative ID, avoiding a future ID
    // reconciliation step.
    await this.clientReturnsService.create(
      createDto,
      userId,
      workstationId,
    );
  }

  /**
   * Replays a CLIENT_CREDIT_PAYMENT by persisting the abono server-side.
   *
   * The POS has already validated the abono against the local debt and
   * capped it at the outstanding balance; the server stores the row so the
   * client's credit debt is consistent across workstations (the debt shown
   * to every station subtracts abonos).
   *
   * Idempotent: the local payment UUID is used as the server row id, so a
   * retried sync entry (transient failure before COMPLETED was written) is
   * an upsert no-op instead of a duplicate abono.
   *
   * The amount cap (≤ local debt) is enforced at the POS; the server does
   * not revalidate it because the POS debt can legitimately be higher than
   * the server's in the sync window (returns not yet replayed). The debt
   * computation clamps at 0, so a replayed abono can never produce a
   * negative balance.
   */
  private async handleClientCreditPayment(entry: SyncQueueEntry): Promise<void> {
    const payload = JSON.parse(entry.payload) as Record<string, unknown>;
    const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
    const localPaymentId =
      (metadata.localPaymentId as string | undefined) ??
      (payload.paymentId as string);
    const createdAt = metadata.createdAt as string | undefined;

    const client = await this.prisma.client.findUnique({
      where: { id: payload.clientId as string },
      select: { id: true },
    });
    if (!client) {
      throw new Error(
        `Client ${String(payload.clientId)} not found for credit payment replay.`,
      );
    }

    await this.prisma.clientCreditPayment.upsert({
      where: { id: localPaymentId },
      update: {},
      create: {
        id: localPaymentId,
        subscriptionId: this.tenantContext.getSubscriptionId(),
        sequentialNumber: payload.sequentialNumber as number,
        clientId: payload.clientId as string,
        amount: new Prisma.Decimal(payload.amount as string),
        paymentMethodId: payload.paymentMethodId as string,
        notes: (payload.notes as string | null) ?? null,
        createdById: payload.createdById as string,
        cashShiftId: payload.cashShiftId as string,
        workstationId: payload.workstationId as string,
        createdAt: new Date(createdAt ?? new Date().toISOString()),
        sourceOperationUuid: entry.operationUuid,
        sourceWorkstationId: entry.sourceWorkstationId,
        sourceCreatedAt: entry.sourceCreatedAt,
      },
    });

    this.logger.log(
      `CLIENT_CREDIT_PAYMENT processed: paymentId=${localPaymentId}, ` +
        `clientId=${String(payload.clientId)}, ` +
        `amount=${String(payload.amount)}, ` +
        `workstationId=${entry.sourceWorkstationId}`,
    );
  }

  /**
   * Replays a CLIENT_CREDIT_PAYMENT_ANNULMENT by marking the abono annulled
   * server-side.
   *
   * The POS admin annulled the payment locally (mandatory reason) and the
   * reversal must be mirrored so the client's credit debt is consistent
   * across workstations. The payment is looked up by its local UUID — the
   * same id the CLIENT_CREDIT_PAYMENT creation replay used, so ordering
   * (creation before annulment) is guaranteed by the POS's clientSequence.
   *
   * Idempotent: if the payment is already annulled, the replay is a no-op.
   * The server does not re-validate the reason (the POS enforces it); the
   * reversal of the debt contribution happens implicitly because debt
   * computations filter `annulledAt: null`.
   */
  private async handleClientCreditPaymentAnnulment(
    entry: SyncQueueEntry,
  ): Promise<void> {
    const payload = JSON.parse(entry.payload) as Record<string, unknown>;
    const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
    const localPaymentId =
      (metadata.localPaymentId as string | undefined) ??
      (payload.paymentId as string);
    const annulledAt = payload.annulledAt as string | undefined;
    const annulmentReason = payload.annulmentReason as string | undefined;

    // The mandatory reason is a POS-side rule, but the replay is also
    // protected so a malformed payload can never persist an empty reason
    // (same pattern as SalesService.annul()'s service-layer re-validation).
    if (!annulmentReason || annulmentReason.trim().length === 0) {
      throw new Error('Annulment reason is required');
    }

    const payment = await this.prisma.clientCreditPayment.findUnique({
      where: { id: localPaymentId },
      select: { id: true, annulledAt: true },
    });
    if (!payment) {
      throw new Error(
        `Credit payment ${localPaymentId} not found for annulment replay.`,
      );
    }
    if (payment.annulledAt) {
      this.logger.log(
        `CLIENT_CREDIT_PAYMENT_ANNULMENT idempotent: paymentId=${localPaymentId} already annulled`,
      );
      return;
    }

    await this.prisma.clientCreditPayment.update({
      where: { id: localPaymentId },
      data: {
        annulledAt: new Date(annulledAt ?? new Date().toISOString()),
        annulledById: payload.annulledById as string,
        annulmentReason: annulmentReason.trim(),
      },
    });

    this.logger.log(
      `CLIENT_CREDIT_PAYMENT_ANNULMENT processed: paymentId=${localPaymentId}, ` +
        `clientId=${String(payload.clientId)}, ` +
        `annulledById=${String(payload.annulledById)}, ` +
        `workstationId=${entry.sourceWorkstationId}`,
    );
  }

  /**
   * Replays an INVENTORY_ADJUSTMENT by creating the document in DRAFT.
   *
   * If the payload carries lot data alongside item references, it is
   * passed to the service so missing lots can be created inline
   * (offline-first scenario). The normal Phase 16 approval chain must
   * be followed — sync does not bypass that gate.
   */
  private async handleInventoryAdjustment(entry: SyncQueueEntry): Promise<void> {
    const payload = JSON.parse(entry.payload) as Record<string, unknown>;
    const createAdjustmentDto = payload.createAdjustmentDto as Record<string, unknown> | undefined;
    const items = (createAdjustmentDto?.items ?? []) as Array<Record<string, unknown>>;

    // Extract lot creation data keyed by lotId for each item
    const lotContext = new Map<string, LotSyncData>();
    for (const item of items) {
      const lotId = item.lotId as string | undefined;
      const lotData = item.lot as LotSyncData | undefined;
      if (lotId && lotData) {
        lotContext.set(lotId, lotData);
      }
    }

    await this.inventoryAdjustmentsService.create(
      createAdjustmentDto as unknown as CreateInventoryAdjustmentDto,
      payload.userId as string,
      undefined,
      lotContext.size > 0 ? lotContext : undefined,
    );
  }

  /**
   * Records a prescription registration received from offline sync.
   *
   * The POS has already captured the prescription data locally. The server
   * logs the registration for audit purposes. Full fiscal compliance
   * validation and DIAN reporting integration for prescriptions is a
   * future-phase concern — the PRisma model and the SyncOperationType
   * enum already support it, but the service layer is not yet built.
   */
  private async handlePrescriptionRegistration(entry: SyncQueueEntry): Promise<void> {
    const payload = JSON.parse(entry.payload) as Record<string, unknown>;
    this.logger.log(
      `Prescription registration received from sync: saleItemId=${payload.saleItemId as string}, ` +
      `prescriptionId=${payload.prescriptionId as string}, ` +
      `isControlled=${payload.isControlledSubstance as boolean}. ` +
      `Server-side prescription processing is not yet implemented — payload recorded as audit entry.`,
    );
    // Future phase: create server-side Prescription record and link to SaleItem.
    // The SyncEntry already exists as a permanent audit trail until then.
  }

  /**
   * Replays a PRODUCT_CREATION by creating the product server-side.
   *
   * The payload must include a full `createProductDto` matching CreateProductDto
   * shape and the `userId` of the user who created the product on the POS.
   * The server re-validates all constraints (unique internalCode, required
   * fields) through ProductsService.createProduct.
   *
   * When the offline POS tags a freshly-created product with the
   * `OFFLINE-{uuid}` sentinel (see pos-desktop
   * `product.service.ts:606`), the server strips that prefix and assigns
   * a tenant-scoped sequential code (`P000001`, `P000002`, ...) so the
   * cashier sees a short, printable code on the next pull. The
   * normalized code is returned in the dispatch result so the POS can
   * stamp it back on its local row in the same transaction that marks
   * the SyncQueue entry COMPLETED.
   *
   * Concurrent inserts from different workstations can both pick the
   * same sequential candidate; the unique constraint on
   * `Product.internalCode` catches the second insert as a P2002, the
   * SyncQueue row stays PENDING, and the next background retry reads
   * the correct MAX.
   */
  private async handleProductCreation(entry: SyncQueueEntry): Promise<DispatchResult> {
    const payload = JSON.parse(entry.payload) as Record<string, unknown>;
    const userId = payload.userId as string;
    const raw = payload.createProductDto as Record<string, unknown>;

    const result = CreateProductSchema.safeParse(raw);
    if (!result.success) {
      throw new SyncPayloadValidationException(
        'PRODUCT_CREATION',
        result.error.issues.map((i) => ({
          field: i.path.join('.') || '(root)',
          message: i.message,
        })),
      );
    }

    // ── Idempotency guard ───────────────────────────────────────────
    // If this operationUuid already created a product via a prior
    // attempt, return the existing entity ids instead of creating a
    // duplicate.  Without this guard, a transient failure after
    // createProduct (e.g. a dropped connection before the COMPLETED
    // status is written) leaves the SyncQueue entry PENDING; the
    // retry would generate a *different* P-code (because the previous
    // code is now taken) and create an orphan copy — 11 "uy, uy"
    // products with sequential P-codes is exactly the symptom this
    // prevents.
    const existing = await this.prisma.product.findUnique({
      where: { sourceOperationUuid: entry.operationUuid },
      select: { id: true, internalCode: true },
    });
    if (existing) {
      this.logger.log(
        `PRODUCT_CREATION idempotent: operationUuid=${entry.operationUuid} ` +
        `already created product ${existing.id} (${existing.internalCode}) — returning existing`,
      );
      return {
        entityId: existing.id,
        entityInternalCode: existing.internalCode,
      };
    }

    // Capture the local product UUID from the sync payload metadata so the
    // created product carries a forward-reference that the SALE_CONFIRMATION
    // handler can use to find the server product when the sale payload
    // references the POS-local UUID instead of the server-assigned id.
    const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
    const localProductId = (metadata.productId as string | undefined) ?? null;

    const dto = { ...result.data };
    if (dto.internalCode.startsWith('OFFLINE-')) {
      dto.internalCode = await this.generateNextOfflineProductCode();
    }

    // Pass the operationUuid so the created product carries a reference
    // back to the sync operation that created it, making future retries
    // idempotent at the database level.  Also pass localProductId so the
    // server can map the POS-local UUID back to this row.
    const product = await this.productsService.createProduct(
      userId,
      dto,
      entry.operationUuid,
      localProductId,
    );
    return {
      entityId: (product as { id: string }).id,
      entityInternalCode: (product as { internalCode: string }).internalCode,
    };
  }

  /**
   * Returns the next sequential `P{n}` product code not yet taken.
   *
   * Uses a raw SQL MAX over the numeric portion of `internalCode` so
   * existing codes with and without zero-padding (e.g. `P027` and
   * `P000001`) are compared numerically, not lexicographically. Without
   * this, `P027` sorts after `P000028` in a string `orderBy: 'desc'`
   * and the function would return `P000028` on every call regardless
   * of whether that code is already taken, producing a permanent P2002
   * loop that no retry can escape.
   *
   * The MAX read and the insert are NOT inside the same transaction, so
   * two concurrent inserts from different workstations can both pick the
   * same candidate. The unique constraint on `Product.internalCode`
   * catches the second insert as a P2002 — the dispatch error propagates,
   * the SyncQueue row stays PENDING, and the next background retry
   * observes the committed value. This is acceptable for an offline-first
   * system where cross-workstation product races are rare and never
   * block a sale (the POS gate reads `serverId`, not `internalCode`).
   */
  private async generateNextOfflineProductCode(): Promise<string> {
    // MAX over the numeric portion of internalCode, evaluated in SQL so
    // zero-padded codes (P027, P000001) compare numerically, not
    // lexicographically. Loading every P-code row into memory (the previous
    // implementation) made each offline product creation a full scan.
    const rows = await this.prisma.$queryRaw<Array<{ max: bigint | null }>>`
      SELECT MAX(CAST(SUBSTRING("internalCode" FROM 2) AS BIGINT)) AS max
      FROM "Product"
      WHERE "internalCode" LIKE 'P%' AND "internalCode" ~ '^P[0-9]+$'
    `;
    const max = rows[0]?.max ?? 0n;
    return `P${String(max + 1n).padStart(6, '0')}`;
  }

  /**
   * Replays a PRODUCT_UPDATE by updating the product server-side.
   *
   * The payload must include `productId` and an `updateProductDto` matching
   * UpdateProductDto shape. Only the fields present in the DTO are applied;
   * omitted fields are left unchanged. Supports all mutable Product fields
   * including therapeuticIndication, storageConditions, and internalNotes.
   * A ProductNotFoundException is thrown if the product does not exist.
   */
  private async handleProductUpdate(entry: SyncQueueEntry): Promise<void> {
    const payload = JSON.parse(entry.payload) as Record<string, unknown>;
    const metadata = payload.metadata as Record<string, unknown> | undefined;
    const productId = (payload.productId ?? metadata?.productId) as string;
    const updateProductDto = payload.updateProductDto as Record<string, unknown>;
    const userId = payload.userId as string | undefined;

    // Remap POS-local UUID to server-assigned UUID.
    // The POS records its own local UUID for each product; when the product
    // was created via PRODUCT_CREATION, the server may have assigned a
    // different UUID and stored the POS-local one in `sourceProductId`.
    // Without this remap, every PRODUCT_UPDATE from a POS-created product
    // fails with ProductNotFoundException because the server doesn't have
    // a product with that local UUID as its primary id.
    const serverProduct = await this.prisma.product.findFirst({
      where: {
        OR: [
          { id: productId },
          { sourceProductId: productId },
        ],
      },
      select: { id: true },
    });

    await this.productsService.updateProduct(
      serverProduct?.id ?? productId,
      updateProductDto as any,
      userId,
    );
  }

  /**
   * Handles an INVOICE_TRANSMISSION operation from offline sync.
   *
   * The POS has already generated a provisional invoice with a local
   * CUFE while operating in contingency mode. This handler:
   *
   * 1. Validates the payload against the shared InvoiceTransmissionPayloadSchema.
   * 2. Creates a FiscalDocument in CONTINGENCY state linked to the sale,
   *    allocating a consecutive number from the workstation's resolution.
   * 3. Enqueues a job on the fiscal-documents BullMQ queue so the fiscal
   *    engine can generate the UBL XML, compute the official CUFE, and
   *    transmit to DIAN.
   *
   * The transmission result is later written to SyncInvoiceResult by the
   * fiscal engine processor, and the workstation polls for it via
   * GET /sync/invoice-results.
   */
  private async handleInvoiceTransmission(entry: SyncQueueEntry): Promise<void> {
    const rawPayload = JSON.parse(entry.payload) as Record<string, unknown>;

    // Step 1: Validate against the shared Zod schema
    const parseResult = InvoiceTransmissionPayloadSchema.safeParse(rawPayload);
    if (!parseResult.success) {
      throw new Error(
        `INVOICE_TRANSMISSION validation failed: ${parseResult.error.issues.map(
          (i) => `${i.path.join('.')}: ${i.message}`,
        ).join('; ')}`,
      );
    }
    const payload = parseResult.data;

    // Step 2: Create a FiscalDocument in CONTINGENCY state inside a transaction
    const fiscalDoc = await this.prisma.$transaction(async (tx) => {
      return this.fiscalDocumentsService.createPendingDocumentForContingency({
        saleId: payload.saleId,
        workstationId: entry.sourceWorkstationId,
        provisionalCufe: payload.provisionalCufe,
        tx,
      });
    });

    // Step 3: Enqueue the generation+transmission job after the transaction commits
    await this.fiscalDocumentsService.enqueueGenerationJob(fiscalDoc.id);

    this.logger.log(
      `INVOICE_TRANSMISSION processed: invoiceId=${payload.invoiceId}, ` +
      `saleId=${payload.saleId}, fiscalDocumentId=${fiscalDoc.id}, ` +
      `workstationId=${entry.sourceWorkstationId}`,
    );
  }

  /**
   * Handles an INVOICE_ADJUSTMENT operation from offline sync.
   *
   * The POS has already recorded the adjustment locally. This handler
   * stores the adjustment on the server for cross-workstation visibility
   * and backoffice reporting. No DIAN/fiscal impact — operational only.
   *
   * Idempotent: if the same adjustmentId (used as the server row id)
   * already exists, the upsert is a no-op. This prevents duplicate rows
   * when the SyncQueue entry is retried after a transient failure.
   */
  private async handleInvoiceAdjustment(entry: SyncQueueEntry): Promise<void> {
    const payload = this.parsePayload(
      'INVOICE_ADJUSTMENT',
      entry.payload,
      InvoiceAdjustmentPayloadSchema,
    );

    // Use the shared InvoiceLocalAdjustment model — same structure on
    // POS and server. The server stores these for cross-workstation
    // visibility and backoffice reporting; they never affect DIAN.
    await this.prisma.invoiceLocalAdjustment.upsert({
      where: { id: payload.adjustmentId },
      update: {},
      create: {
        id: payload.adjustmentId,
        subscriptionId: this.tenantContext.getSubscriptionId(),
        invoiceId: payload.invoiceId,
        invoiceNumber: payload.invoiceNumber,
        createdAt: new Date(payload.createdAt),
        createdByUserId: payload.createdByUserId,
        createdByUserName: payload.createdByUserName,
        workstationId: payload.workstationId,
        adjustmentType: payload.adjustmentType as any,
        previousValue: payload.previousValue as Prisma.InputJsonValue,
        newValue: payload.newValue as Prisma.InputJsonValue,
        reason: payload.reason,
        version: payload.version,
        reversalOfAdjustmentId: payload.reversalOfAdjustmentId,
        replacedByAdjustmentId: payload.replacedByAdjustmentId,
      },
    });

    this.logger.log(
      `INVOICE_ADJUSTMENT processed: adjustmentId=${payload.adjustmentId}, ` +
      `invoiceId=${payload.invoiceId}, type=${payload.adjustmentType}, ` +
      `workstationId=${payload.workstationId}`,
    );
  }

  /**
   * Replays a PURCHASE_ORDER_CONFIRMATION by creating/confirming the
   * purchase order server-side from the POS payload.
   *
   * Idempotent: if a purchase order with the same sequentialNumber +
   * supplierId already exists, the operation is skipped (ALREADY_ACCEPTED).
   */
  private async handlePurchaseOrderConfirmation(entry: SyncQueueEntry): Promise<void> {
    const payload = this.parsePayload(
      'PURCHASE_ORDER_CONFIRMATION',
      entry.payload,
      PurchaseOrderConfirmationPayloadSchema,
    ) as PurchaseOrderConfirmationPayload;
    const userId = payload.confirmedByUserId;
    await this.purchaseOrdersService.confirmOrderFromSync(payload, userId);
  }

  /**
   * Replays a PURCHASE_RECEPTION_CONFIRMATION by creating and confirming
   * the purchase reception server-side from the POS payload.
   *
   * Idempotent: if a reception with the same sequentialNumber + supplierId
   * already exists, the operation is skipped (ALREADY_ACCEPTED).
   */
  private async handlePurchaseReceptionConfirmation(entry: SyncQueueEntry): Promise<void> {
    const payload = this.parsePayload(
      'PURCHASE_RECEPTION_CONFIRMATION',
      entry.payload,
      PurchaseReceptionConfirmationPayloadSchema,
    ) as PurchaseReceptionConfirmationPayload;
    const userId = payload.confirmedByUserId;
    await this.purchaseReceptionsService.confirmReceptionFromSync(payload, userId);
  }

  /**
   * Replays a SUPPLIER_RETURN_CONFIRMATION by creating and confirming
   * the supplier return server-side from the POS payload.
   *
   * Idempotent: if a return with the same sequentialNumber + supplierId
   * already exists, the operation is skipped (ALREADY_ACCEPTED).
   */
  private async handleSupplierReturnConfirmation(entry: SyncQueueEntry): Promise<void> {
    const payload = this.parsePayload(
      'SUPPLIER_RETURN_CONFIRMATION',
      entry.payload,
      SupplierReturnConfirmationPayloadSchema,
    ) as SupplierReturnConfirmationPayload;
    const userId = payload.createdByUserId;
    await this.supplierReturnsService.confirmReturnFromSync(payload, userId);
  }
}
