-- Add SHIFT_OPEN to SyncOperationType enum for global shift open sync
ALTER TYPE "SyncOperationType" ADD VALUE IF NOT EXISTS 'SHIFT_OPEN';
