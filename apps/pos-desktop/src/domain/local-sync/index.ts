/**
 * Local network sync domain logic.
 *
 * Pure functions for peer validation, operation merging, and hub
 * election. No side effects — these are safe to call from any context.
 */

export { isValidPeer, type PeerValidationResult } from './peer-validation';
export { mergeLocalOperations } from './operation-merge';
export {
  electHub,
  computeHubScore,
  type HubElectionInput,
  type ElectionResult,
} from './hub-election';

export type {
  LocalSyncConfig,
  RejectedOperation,
} from './types';

// Re-export shared types for convenience.
export {
  HubRole,
  LocalSyncConnectionStatus,
  ConflictReason,
} from '@pharmacy/shared-types';
export type {
  LocalOperation,
  DiscoveredPeer,
  HubInfo,
  HubScore,
  LocalSyncStatus,
  LocalNetworkAuditEvent,
} from '@pharmacy/shared-types';
