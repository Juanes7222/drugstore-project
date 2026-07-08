import { Injectable } from '@nestjs/common';
import { CashShiftService } from '@/modules/cash-shift/cash-shift.service';
import { ClientsService } from '@/modules/clients/clients.service';
import { SalesService } from '@/modules/sales-pos/services/sales.service';
import { InventoryAdjustmentsService } from '@/modules/inventory-lots/services/inventory-adjustments.service';

/**
 * Re-executes the real business logic for each supported offline operation.
 * This is NOT a blind trust of the offline payload — it re-validates every
 * constraint against the server's current state.
 */
@Injectable()
export class SyncOperationDispatcherService {
  constructor(
    private readonly cashShiftService: CashShiftService,
    private readonly clientsService: ClientsService,
    private readonly salesService: SalesService,
    private readonly inventoryAdjustmentsService: InventoryAdjustmentsService,
  ) {}

  /** Routes a SyncQueue entry to the appropriate replay handler. */
  async dispatch(entry: any): Promise<void> {
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
      case 'INVENTORY_ADJUSTMENT':
        await this.handleInventoryAdjustment(entry);
        break;
      // FISCAL_DOCUMENT_SYNC, PRESCRIPTION_REGISTRATION, RESOLUTION_ALLOCATION
      // are not dispatched — the job never selects them.
    }
  }

  /** Replays a SALE_CONFIRMATION by creating and confirming the sale server-side. */
  private async handleSaleConfirmation(entry: any): Promise<void> {
    const payload = JSON.parse(entry.payload);
    const userId = payload.userId;
    const workstationId = entry.sourceWorkstationId;

    const sale = await this.salesService.create(
      payload.createSaleDto,
      userId,
      workstationId,
    );
    await this.salesService.confirm(
      sale.id,
      payload.confirmSaleDto,
      userId,
    );
  }

  /** Replays a SHIFT_CLOSURE: registers closing cash counts then closes the shift. */
  private async handleShiftClosure(entry: any): Promise<void> {
    const payload = JSON.parse(entry.payload);
    const userId = payload.userId;
    const shiftId = payload.shiftId;

    for (const count of payload.cashCounts ?? []) {
      await this.cashShiftService.registerCashCount(shiftId, userId, count);
    }
    await this.cashShiftService.closeShift(shiftId, userId, {
      closingNotes: payload.closingNotes,
    });
  }

  /**
   * Replays a CLIENT_CREATION by creating or updating the client server-side.
   *
   * The client's UUID from the POS is preserved (via `payload.metadata.localClientId`)
   * so that future sync operations that reference this client by ID (e.g. sale
   * confirmations) resolve correctly.  If the `[identificationType, identificationNumber]`
   * unique constraint is violated, `clientsService.create` performs an upsert —
   * the POS's data is treated as the latest version.
   */
  private async handleClientCreation(entry: any): Promise<void> {
    const payload = JSON.parse(entry.payload);
    const clientId: string | undefined = payload.metadata?.localClientId;
    await this.clientsService.create(
      payload.createClientDto,
      payload.userId,
      clientId,
    );
  }

  /**
   * Replays an INVENTORY_ADJUSTMENT by creating the document in DRAFT.
   * The normal Phase 16 approval chain must be followed — sync does not
   * bypass that gate.
   */
  private async handleInventoryAdjustment(entry: any): Promise<void> {
    const payload = JSON.parse(entry.payload);
    await this.inventoryAdjustmentsService.create(
      payload.createAdjustmentDto,
      payload.userId,
    );
  }
}
