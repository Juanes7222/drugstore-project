/**
 * LAN HTTP server — infrastructure for peer-to-peer sync over the local
 * network.
 *
 * Exports:
 * - `LanServer`            HTTP server that receives sync events and
 *                          heartbeats from peer workstations.
 * - `PeerTracker`          In-memory peer state tracker (last seen,
 *                          status, cleanup).
 * - `LanServerBindError`   Error class for bind failures.
 * - Zod schemas & types    `SyncEventSchema`, `HeartbeatSchema`,
 *                          `SyncEvent`, `HeartbeatPayload`, etc.
 * - Constants              `DEFAULT_LAN_PORT`, `DEFAULT_LAN_HOST`.
 */

export { LanServer, LanServerStartError, DEFAULT_LAN_PORT, DEFAULT_LAN_HOST } from './lan-server';
export type { LanServerConfig } from './lan-server';

export { PeerTracker } from './peer-tracker';
export type { PeerState, PeerSnapshot } from './peer-tracker';

export {
  SyncEventSchema,
  HeartbeatSchema,
  HEARTBEAT_STATUSES,
} from './lan.dto';
export type {
  SyncEvent,
  HeartbeatPayload,
  HeartbeatStatus,
  HealthResponse,
  ErrorResponse,
} from './lan.dto';
