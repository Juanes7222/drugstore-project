-- Create SyncSource enum type
CREATE TYPE "SyncSource" AS ENUM ('DIRECT', 'LOCAL_HUB');

-- Add operation_source column to SyncQueue
ALTER TABLE "SyncQueue" ADD COLUMN "operationSource" "SyncSource" NOT NULL DEFAULT 'DIRECT';

-- Add operation_source column to SyncOperationOutcome
ALTER TABLE "SyncOperationOutcome" ADD COLUMN "operationSource" "SyncSource" NOT NULL DEFAULT 'DIRECT';
