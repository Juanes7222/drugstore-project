/**
 * Local sync domain types.
 *
 * Extends the shared types with domain-specific internal types not
 * exposed across the package boundary.
 */

import type {
  LocalOperation,
  ConflictReason,
} from '@pharmacy/shared-types';

/**
 * Persisted local sync configuration for this workstation.
 */
export interface LocalSyncConfig {
  enabled: boolean;
  localNetworkKey: string | null;
  hubOverride: string | null;
  autoElectionEnabled: boolean;
  lastKeyRotationAt: string | null;
}

/**
 * An operation that was rejected during merge.
 */
export interface RejectedOperation {
  operation: LocalOperation;
  reason: ConflictReason;
  winningOperationUuid: string;
}

/**
 * Result of merging local and remote operation queues.
 */
export interface MergeResult {
  winningOperations: LocalOperation[];
  rejectedOperations: RejectedOperation[];
}
