import { SyncStatus } from "./enums";

export interface SyncQueueEntry {
  id: string;
  entityType: string;
  entityId: string;
  operation: string;
  payload: string;
  status: SyncStatus;
  attempts: number;
  lastError: string | null;
  scheduledAt: string;
  processedAt: string | null;
  createdAt: string;
}
