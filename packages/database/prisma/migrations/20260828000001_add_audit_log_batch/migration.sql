-- Add AUDIT_LOG_BATCH to SyncOperationType enum for offline audit log sync
ALTER TYPE "SyncOperationType" ADD VALUE IF NOT EXISTS 'AUDIT_LOG_BATCH';
