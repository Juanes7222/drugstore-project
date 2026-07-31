/**
 * Zod validation schemas and inferred types for the LAN HTTP server.
 *
 * Every incoming request payload is validated against these schemas before
 * being forwarded to the sync engine or the peer tracker.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Sync event
// ---------------------------------------------------------------------------

/**
 * Zod schema for a sync event pushed by a peer workstation over the LAN.
 *
 * Mirrors the shape that the server-facing batch endpoint accepts so the
 * same dispatch pipeline can handle LAN-origin events without transformation.
 */
export const SyncEventSchema = z.object({
  /** The domain entity type (e.g. "Product", "Sale", "Client"). */
  entityType: z.string().min(1, 'entityType is required'),
  /** The local UUID of the entity being synced. */
  entityId: z.string().min(1, 'entityId is required'),
  /** The action performed (e.g. "CREATE", "UPDATE", "DELETE"). */
  action: z.string().min(1, 'action is required'),
  /** Free-form payload carrying the operation data. */
  payload: z.record(z.string(), z.unknown()),
  /** Identifies which workstation originated this event. */
  sourceWorkstationId: z.string().min(1, 'sourceWorkstationId is required'),
  /** ISO-8601 timestamp of when the event was generated. */
  timestamp: z.iso.datetime({ message: 'Invalid ISO-8601 timestamp' }),
});

/** Inferred type for a validated sync event. */
export type SyncEvent = z.infer<typeof SyncEventSchema>;

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

/** Valid heartbeat status values. */
export const HEARTBEAT_STATUSES = ['online', 'busy', 'idle'] as const;

/** Valid heartbeat status type. */
export type HeartbeatStatus = (typeof HEARTBEAT_STATUSES)[number];

/**
 * Zod schema for a heartbeat sent by a hub or a peer workstation
 * on the LAN.
 */
export const HeartbeatSchema = z.object({
  /** The workstation sending the heartbeat. */
  workstationId: z.string().min(1, 'workstationId is required'),
  /** ISO-8601 timestamp of the heartbeat. */
  timestamp: z.iso.datetime({ message: 'Invalid ISO-8601 timestamp' }),
  /** Current operational status of the workstation. */
  status: z.enum(HEARTBEAT_STATUSES),
});

/** Inferred type for a validated heartbeat payload. */
export type HeartbeatPayload = z.infer<typeof HeartbeatSchema>;

// ---------------------------------------------------------------------------
// Health response
// ---------------------------------------------------------------------------

/** Shape of the /health endpoint response. */
export interface HealthResponse {
  status: 'ok';
  uptime: number;
  version: string;
}

// ---------------------------------------------------------------------------
// Standard error response
// ---------------------------------------------------------------------------

/** Shape returned by the server on validation or internal errors. */
export interface ErrorResponse {
  error: string;
  details?: unknown;
}
