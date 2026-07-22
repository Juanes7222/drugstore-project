/**
 * Strict interface for SyncQueue entries processed by the dispatcher.
 *
 * Mirrors the Prisma SyncQueue model fields that the dispatcher and
 * processing job actually consume.  Using this instead of `any` ensures
 * that every handler method enforces access to well-known properties
 * and that no silent undefined-ref sneaks past the compiler.
 */
export interface SyncQueueEntry {
  id: string;
  operationUuid: string;
  operationType:
    | 'SALE_CONFIRMATION'
    | 'SHIFT_CLOSURE'
    | 'CLIENT_CREATION'
    | 'CLIENT_UPDATE'
    | 'CLIENT_DEACTIVATE'
    | 'CLIENT_RETURN'
    | 'INVENTORY_ADJUSTMENT'
    | 'FISCAL_DOCUMENT_SYNC'
    | 'PRESCRIPTION_REGISTRATION'
    | 'RESOLUTION_ALLOCATION'
    | 'INVOICE_TRANSMISSION'
    | 'INVOICE_TRANSMISSION_RESULT'
    | 'PRODUCT_CREATION'
    | 'PRODUCT_UPDATE';
  payload: string;
  sourceWorkstationId: string;
  retryCount: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  lastErrorMessage?: string | null;
  nextRetryAt?: Date | null;
  correlationId?: string | null;
  operationSource: 'DIRECT' | 'LOCAL_HUB';
}

export type SyncQueueEntryEntity = SyncQueueEntry;
