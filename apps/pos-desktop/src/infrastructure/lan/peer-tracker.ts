/**
 * In-memory tracker for peer workstation status on the LAN.
 *
 * Maintains a map of workstationId → lastSeen timestamp and latest status.
 * Heartbeats received by the LAN server update this tracker so the rest of
 * the application can query peer liveness without polling.
 *
 * This module has no I/O and no external dependencies — it is a simple
 * concurrent-safe (single-threaded JS) map wrapper.
 */

import type { HeartbeatStatus } from './lan.dto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-peer state tracked in memory. */
export interface PeerState {
  workstationId: string;
  lastSeenAt: number; // Unix timestamp (ms)
  status: HeartbeatStatus;
}

/**
 * Snapshot of all known peers and their current state.
 * Sorted by lastSeenAt descending (most recently seen first).
 */
export interface PeerSnapshot {
  peers: PeerState[];
  totalCount: number;
  onlineCount: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Duration (ms) after which a peer is considered offline if no heartbeat
 * has been received.
 */
export const DEFAULT_PEER_STALE_THRESHOLD_MS = 30_000; // 30 seconds

/**
 * Interval (ms) for periodic stale-peer cleanup.
 */
export const DEFAULT_CLEANUP_INTERVAL_MS = 60_000; // 1 minute

// ---------------------------------------------------------------------------
// PeerTracker
// ---------------------------------------------------------------------------

export class PeerTracker {
  private readonly peers = new Map<string, PeerState>();
  private readonly staleThreshold: number;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined = undefined;

  /**
   * @param staleThreshold  Milliseconds after which a peer is stale
   *                        (default 30 s).
   * @param cleanupInterval Milliseconds between automatic stale-peer
   *                        eviction runs (default 1 min). Pass 0 to
   *                        disable auto-cleanup.
   */
  constructor(
    staleThreshold: number = DEFAULT_PEER_STALE_THRESHOLD_MS,
    cleanupInterval: number = DEFAULT_CLEANUP_INTERVAL_MS,
  ) {
    this.staleThreshold = staleThreshold;

    if (cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => {
        this.removeStalePeers();
      }, cleanupInterval);
      // Timer is allowed to keep the process alive (fine in Tauri webview).
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Record or update a peer heartbeat.
   *
   * @param workstationId  The peer's workstation identifier.
   * @param status         Current operational status.
   */
  update(workstationId: string, status: HeartbeatStatus): void {
    this.peers.set(workstationId, {
      workstationId,
      lastSeenAt: Date.now(),
      status,
    });
  }

  /**
   * Return the stored state for a single peer, or `null` if never seen.
   */
  get(workstationId: string): PeerState | null {
    return this.peers.get(workstationId) ?? null;
  }

  /**
   * Return a snapshot of all tracked peers.
   *
   * Peers whose `lastSeenAt` is older than `staleThreshold` are excluded.
   */
  getSnapshot(): PeerSnapshot {
    const now = Date.now();
    const cutoff = now - this.staleThreshold;
    const active: PeerState[] = [];

    for (const state of this.peers.values()) {
      if (state.lastSeenAt >= cutoff) {
        active.push(state);
      }
    }

    // Sort: most recently seen first.
    active.sort((a, b) => b.lastSeenAt - a.lastSeenAt);

    return {
      peers: active,
      totalCount: this.peers.size,
      onlineCount: active.length,
    };
  }

  /**
   * Remove a peer from the tracker entirely.
   */
  remove(workstationId: string): void {
    this.peers.delete(workstationId);
  }

  /**
   * Remove all peers whose lastSeenAt is older than the stale threshold.
   * Returns the number of peers removed.
   */
  removeStalePeers(): number {
    const now = Date.now();
    const cutoff = now - this.staleThreshold;
    let removed = 0;

    for (const [id, state] of this.peers) {
      if (state.lastSeenAt < cutoff) {
        this.peers.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Clear all peer state and stop the cleanup timer.
   * After disposal the tracker is no longer usable.
   */
  dispose(): void {
    if (this.cleanupTimer !== undefined) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.peers.clear();
  }

  /**
   * Return the number of currently tracked (non-stale) peers.
   */
  get activeCount(): number {
    return this.getSnapshot().onlineCount;
  }

  /**
   * Return the raw count of entries in the map (including stale).
   */
  get totalTracked(): number {
    return this.peers.size;
  }
}
