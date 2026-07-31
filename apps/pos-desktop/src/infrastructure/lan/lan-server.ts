/**
 * LAN HTTP server manager.
 *
 * Wraps the Rust Axum HTTP server running in the Tauri backend.  Provides
 * start/stop lifecycle, Zod validation of incoming sync events received
 * via Tauri IPC, and an in-memory peer tracker for heartbeat monitoring.
 *
 * Architecture
 * ------------
 * The actual HTTP server runs in the Tauri Rust backend (Axum on tokio).
 * This TypeScript class is the bridge:
 *
 *  1. `start()` / `stop()` call Tauri `invoke` commands that manage
 *     the Rust server process.
 *  2. Incoming sync events arrive as Tauri events emitted by the Rust
 *     handler — this class validates them with Zod and forwards them
 *     to the registered `onSyncEvent` callback (typically the local
 *     sync engine).
 *  3. Heartbeats are tracked in-memory via the injected `PeerTracker`.
 *
 * This decouples the HTTP transport (Rust) from validation and business
 * logic (TypeScript), keeping Zod as the single validation source.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { SyncEventSchema, HeartbeatSchema } from './lan.dto';
import type { SyncEvent, HeartbeatPayload } from './lan.dto';
import { PeerTracker } from './peer-tracker';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default port for the LAN HTTP server. */
export const DEFAULT_LAN_PORT = 49_500;

/** Default host address (0.0.0.0 — listen on all interfaces). */
export const DEFAULT_LAN_HOST = '0.0.0.0';

/** Tauri event emitted by the Rust server when a sync event arrives. */
const EVENT_SYNC_EVENT_RECEIVED = 'lan-sync-event-received';

/** Tauri event emitted by the Rust server when a heartbeat arrives. */
const EVENT_HEARTBEAT_RECEIVED = 'lan-heartbeat-received';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface LanServerConfig {
  /** TCP port (default 49_500). */
  port?: number;
  /** Host address (default 0.0.0.0). */
  host?: string;
  /**
   * When true (default), if the configured port is already in use the
   * Rust server tries the next port before giving up.
   */
  portFallback?: boolean;
  /**
   * Optional callback invoked when a validated sync event is received
   * from a peer workstation.
   */
  onSyncEvent?: (event: SyncEvent) => void;
  /**
   * Optional callback invoked when a validated heartbeat is received.
   */
  onHeartbeat?: (heartbeat: HeartbeatPayload) => void;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Thrown when the server cannot start. */
export class LanServerStartError extends Error {
  readonly causeMessage: string;

  constructor(message: string) {
    super(message);
    this.name = 'LanServerStartError';
    this.causeMessage = message;
  }
}

// ---------------------------------------------------------------------------
// LanServer
// ---------------------------------------------------------------------------

export class LanServer {
  private readonly config: Required<LanServerConfig>;
  private readonly peerTracker: PeerTracker;
  private unlistenSyncEvent: UnlistenFn | null = null;
  private unlistenHeartbeat: UnlistenFn | null = null;
  private started = false;

  constructor(config: LanServerConfig, peerTracker: PeerTracker) {
    this.config = {
      port: config.port ?? DEFAULT_LAN_PORT,
      host: config.host ?? DEFAULT_LAN_HOST,
      portFallback: config.portFallback ?? true,
      onSyncEvent: config.onSyncEvent ?? (() => {}),
      onHeartbeat: config.onHeartbeat ?? (() => {}),
    };
    this.peerTracker = peerTracker;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the LAN HTTP server.
   *
   * 1. Calls the Rust `start_hub_server` Tauri command.
   * 2. Registers Tauri event listeners for incoming sync events and
   *    heartbeats forwarded by the Rust backend.
   *
   * @throws {LanServerStartError} when the Rust command fails.
   */
  async start(): Promise<void> {
    if (this.started) {
      console.warn('[LanServer] Already started — ignoring start().');
      return;
    }

    try {
      // The Rust command handles port binding, fallback, and server start.
      // It uses the port/host configured via `initialize_local_sync`.
      await invoke<void>('start_hub_server');
      console.log(
        `[LanServer] Rust server started on port ${this.config.port}.`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new LanServerStartError(
        `Failed to start LAN server: ${message}`,
      );
    }

    // Register Tauri event listeners for incoming data.
    try {
      this.unlistenSyncEvent = await listen<unknown>(
        EVENT_SYNC_EVENT_RECEIVED,
        (event) => this.onSyncEventReceived(event.payload),
      );
      this.unlistenHeartbeat = await listen<unknown>(
        EVENT_HEARTBEAT_RECEIVED,
        (event) => this.onHeartbeatReceived(event.payload),
      );
    } catch (err: unknown) {
      // Tauri events might not be available outside the webview (e.g.
      // in a bare-bones test environment).  Log and continue.
      console.warn(
        '[LanServer] Failed to register Tauri event listeners:',
        err instanceof Error ? err.message : err,
      );
    }

    this.started = true;
  }

  /**
   * Gracefully stop the LAN HTTP server and unregister all event
   * listeners.
   */
  async stop(): Promise<void> {
    if (!this.started) return;

    // Unregister event listeners.
    this.unlistenSyncEvent?.();
    this.unlistenSyncEvent = null;
    this.unlistenHeartbeat?.();
    this.unlistenHeartbeat = null;

    // Stop the Rust server.
    try {
      await invoke<void>('stop_hub_server');
      console.log('[LanServer] Stopped.');
    } catch (err: unknown) {
      console.warn(
        '[LanServer] Error stopping Rust server:',
        err instanceof Error ? err.message : err,
      );
    }

    this.started = false;
  }

  // -----------------------------------------------------------------------
  // Getters
  // -----------------------------------------------------------------------

  /** Whether the server is running. */
  get isRunning(): boolean {
    return this.started;
  }

  /** The configured port. */
  get port(): number {
    return this.config.port;
  }

  /** The configured host. */
  get host(): string {
    return this.config.host;
  }

  /** The peer tracker instance used by this server. */
  get tracker(): PeerTracker {
    return this.peerTracker;
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  /**
   * Called when the Rust server emits a `lan-sync-event-received` event.
   * Validates the payload with Zod and forwards to the registered
   * callback.
   */
  private onSyncEventReceived(payload: unknown): void {
    const result = SyncEventSchema.safeParse(payload);

    if (!result.success) {
      console.warn(
        '[LanServer] Received invalid sync event from peer:',
        result.error.issues,
      );
      return;
    }

    const event: SyncEvent = result.data;

    // Update peer activity.
    this.peerTracker.update(event.sourceWorkstationId, 'online');

    // Forward to the registered callback.
    try {
      this.config.onSyncEvent(event);
    } catch (cbErr) {
      console.error(
        '[LanServer] onSyncEvent callback threw:',
        cbErr instanceof Error ? cbErr.message : cbErr,
      );
    }
  }

  /**
   * Called when the Rust server emits a `lan-heartbeat-received` event.
   * Validates the payload with Zod, updates the peer tracker, and
   * forwards to the registered callback.
   */
  private onHeartbeatReceived(payload: unknown): void {
    const result = HeartbeatSchema.safeParse(payload);

    if (!result.success) {
      console.warn(
        '[LanServer] Received invalid heartbeat from peer:',
        result.error.issues,
      );
      return;
    }

    const heartbeat: HeartbeatPayload = result.data;

    // Update peer tracker.
    this.peerTracker.update(heartbeat.workstationId, heartbeat.status);

    // Forward to the registered callback.
    try {
      this.config.onHeartbeat(heartbeat);
    } catch (cbErr) {
      console.error(
        '[LanServer] onHeartbeat callback threw:',
        cbErr instanceof Error ? cbErr.message : cbErr,
      );
    }
  }
}
