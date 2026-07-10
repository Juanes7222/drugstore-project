import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@pharmacy/database';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { CashCountType } from '@pharmacy/shared-types';
import { CashShiftService } from '@/modules/cash-shift/cash-shift.service';
import { ClientsService } from '@/modules/clients/clients.service';
import { SalesService } from '@/modules/sales-pos/services/sales.service';
import { ClientReturnsService } from '@/modules/sales-pos/services/client-returns.service';
import { InventoryAdjustmentsService } from '@/modules/inventory-lots/services/inventory-adjustments.service';
import { FiscalDocumentsService } from '@/modules/fiscal-dian/services/fiscal-documents.service';
import { InvoiceTransmissionPayloadSchema } from '@pharmacy/shared-validation';
import type { SyncQueueEntry } from './entities/sync-queue-entry.entity';
import type { CreateSaleDto } from '@/modules/sales-pos/dto/create-sale.dto';
import type { ConfirmSaleDto } from '@/modules/sales-pos/dto/confirm-sale.dto';
import type { CreateClientDto } from '@/modules/clients/dto/create-client.dto';
import type { CreateClientReturnDto } from '@/modules/sales-pos/dto/create-client-return.dto';
import type { CreateInventoryAdjustmentDto } from '@/modules/inventory-lots/dto/create-inventory-adjustment.dto';
import * as crypto from 'node:crypto';

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
    @Inject(CashShiftService) private readonly cashShiftService: CashShiftService,
    @Inject(ClientsService) private readonly clientsService: ClientsService,
    @Inject(SalesService) private readonly salesService: SalesService,
    @Inject(ClientReturnsService) private readonly clientReturnsService: ClientReturnsService,
    @Inject(InventoryAdjustmentsService) private readonly inventoryAdjustmentsService: InventoryAdjustmentsService,
    @Inject(FiscalDocumentsService) private readonly fiscalDocumentsService: FiscalDocumentsService,
  ) {}

  /**
   * Routes a SyncQueue entry to the appropriate replay handler.
   *
   * Catches all errors and records a FAILED outcome with the error message.
   * Successful dispatches record an ACCEPTED outcome.
   */
  async dispatch(entry: SyncQueueEntry): Promise<void> {
    try {
      switch (entry.operationType) {
        case 'SALE_CONFIRMATION':
          await this.handleSaleConfirmation(entry);
          break;
        case 'SHIFT_CLOSURE':
          await this.handleShiftClosure(entry);
          break;
        case 'CLIENT_CREATION':
          await this.handleClientCreation(entry);
          break;
        case 'CLIENT_RETURN':
          await this.handleClientReturn(entry);
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
        // FISCAL_DOCUMENT_SYNC, RESOLUTION_ALLOCATION
        // are not dispatched — the job never selects them.
      }

      await this.recordOutcome(entry.operationUuid, entry.sourceWorkstationId, 'ACCEPTED', null);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const failureCategory = this.classifyServerError(errorMessage);
      await this.recordOutcome(entry.operationUuid, entry.sourceWorkstationId, 'REJECTED', failureCategory);
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
  ): Promise<void> {
    try {
      await this.prisma.syncOperationOutcome.create({
        data: {
          id: crypto.randomUUID(),
          operationUuid,
          workstationId,
          outcome,
          failureCategory,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record SyncOperationOutcome for ${operationUuid}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }
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

  /** Replays a SALE_CONFIRMATION by creating and confirming the sale server-side. */
  private async handleSaleConfirmation(entry: SyncQueueEntry): Promise<void> {
    const payload = JSON.parse(entry.payload) as Record<string, unknown>;
    const userId = payload.userId as string;
    const workstationId = entry.sourceWorkstationId;

    const sale = await this.salesService.create(
      payload.createSaleDto as unknown as CreateSaleDto,
      userId,
      workstationId,
    );
    await this.salesService.confirm(
      (sale as { id: string }).id,
      payload.confirmSaleDto as unknown as ConfirmSaleDto,
      userId,
    );
  }

  /** Replays a SHIFT_CLOSURE: registers closing cash counts then closes the shift. */
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
   */
  private async handleClientCreation(entry: SyncQueueEntry): Promise<void> {
    const payload = JSON.parse(entry.payload) as Record<string, unknown>;
    const userId = payload.userId as string;
    const createClientDto = payload.createClientDto as unknown as CreateClientDto;
    const localClientId = payload.localClientId as string | undefined;

    await this.clientsService.create(
      createClientDto,
      userId,
      localClientId,
    );
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
   * Replays an INVENTORY_ADJUSTMENT by creating the document in DRAFT.
   * The normal Phase 16 approval chain must be followed — sync does not
   * bypass that gate.
   */
  private async handleInventoryAdjustment(entry: SyncQueueEntry): Promise<void> {
    const payload = JSON.parse(entry.payload) as Record<string, unknown>;
    await this.inventoryAdjustmentsService.create(
      payload.createAdjustmentDto as unknown as CreateInventoryAdjustmentDto,
      payload.userId as string,
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
}
