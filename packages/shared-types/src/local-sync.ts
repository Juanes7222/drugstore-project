/**
 * Shared types for local network sync between workstations.
 *
 * These types mirror the shapes exchanged over the LAN and stored in
 * the local sync queue. They are a strict subset of the existing
 * server-facing sync protocol.
 */

// ---------------------------------------------------------------------------
// Local network operation
// ---------------------------------------------------------------------------

/**
 * An operation exchanged between workstations on the LAN.
 *
 * Mirrors the shape used for server-facing SyncQueue operations so
 * the existing dispatch, conflict resolution, and audit logic can
 * handle local-network operations without modification.
 */
export interface LocalOperation {
  operationUuid: string;
  operationType: string;
  payload: string;
  payloadHash: string;
  sourceWorkstationId: string;
  sourceCreatedAt: string;
  retryCount: number;
}

// ---------------------------------------------------------------------------
// Peer discovery
// ---------------------------------------------------------------------------

/** A workstation discovered on the LAN via mDNS. */
export interface DiscoveredPeer {
  workstationId: string;
  friendlyName: string;
  ipAddress: string;
  port: number;
  hubEligible: boolean;
  isCurrentHub: boolean;
  authTokenHash: string;
  appVersion: string;
  firstSeenAt: string;
  lastSeenAt: string;
  isOnline: boolean;
}

// ---------------------------------------------------------------------------
// Hub
// ---------------------------------------------------------------------------

/** Information about the current local hub. */
export interface HubInfo {
  workstationId: string;
  friendlyName: string;
  ipAddress: string;
  port: number;
  hubScore: number;
  role: HubRole;
  isSelf: boolean;
}

/** Role the workstation plays in the local network. */
export enum HubRole {
  AUTO = 'AUTO',
  FORCED = 'FORCED',
  CANDIDATE = 'CANDIDATE',
  NOT_HUB = 'NOT_HUB',
}

// ---------------------------------------------------------------------------
// Sync status
// ---------------------------------------------------------------------------

/** Connection status to the local hub. */
export enum LocalSyncConnectionStatus {
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  RECONNECTING = 'RECONNECTING',
}

/** Full status report for local sync. */
export interface LocalSyncStatus {
  connectionStatus: LocalSyncConnectionStatus;
  currentHubId: string | null;
  currentHubAddress: string | null;
  pendingPushCount: number;
  pendingPullCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
  backoffUntil: string | null;
}

// ---------------------------------------------------------------------------
// Hub election
// ---------------------------------------------------------------------------

/** A peer's computed hub score and metadata. */
export interface HubScore {
  workstationId: string;
  friendlyName: string;
  score: number;
  onlineTimeHours: number;
  stabilityFactor: number;
  diskSpaceGb: number;
  isAlwaysOn: boolean;
  isOnline: boolean;
}

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

/** Result of merging local operations from different workstations. */
export interface MergeResult {
  winningOperations: LocalOperation[];
  rejectedOperations: RejectedOperation[];
}

/** An operation that was rejected due to conflict. */
export interface RejectedOperation {
  operation: LocalOperation;
  reason: ConflictReason;
  winningOperationUuid: string;
}

/** Reasons an operation can be rejected during merge. */
export enum ConflictReason {
  FIRST_WRITE_WINS = 'FIRST_WRITE_WINS',
  HUB_CONFLICT_REJECTED = 'HUB_CONFLICT_REJECTED',
  HUB_CONFLICT_DEPENDENCY_MISSING = 'HUB_CONFLICT_DEPENDENCY_MISSING',
  SERVER_WINS = 'SERVER_WINS',
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Local sync configuration persisted on each workstation. */
export interface LocalSyncConfig {
  enabled: boolean;
  localNetworkKey: string | null;
  hubOverride: string | null;
  autoElectionEnabled: boolean;
  lastKeyRotationAt: string | null;
}

// ---------------------------------------------------------------------------
// Audit event types
// ---------------------------------------------------------------------------

/** Audit event type for local network events. */
export type LocalNetworkAuditEvent =
  | 'LOCAL_NETWORK_ENABLED'
  | 'LOCAL_NETWORK_DISABLED'
  | 'HUB_ELECTED'
  | 'HUB_CHANGED'
  | 'LOCAL_SYNC_PUSH_SUCCESS'
  | 'LOCAL_SYNC_PUSH_FAILED'
  | 'LOCAL_SYNC_PULL_SUCCESS'
  | 'LOCAL_SYNC_PULL_FAILED'
  | 'LOCAL_NETWORK_KEY_ROTATED'
  | 'HUB_CONFLICT_DETECTED'
  | 'HUB_CONFLICT_RESOLVED'
  | 'PEER_DISCOVERED'
  | 'PEER_LOST';
