/**
 * Holder for the process-wide LocalSyncEngine instance.
 *
 * The engine is created once in `initializeServices()` (which owns the
 * Prisma client and the workstation identity). UI entry points that need an
 * immediate LAN cycle — the sync-health "sync now" action, the local-network
 * "force sync" action — resolve the engine here instead of constructing an
 * ad-hoc replacemement that lacks the real configuration.
 *
 * Pure holder, no I/O and no React, so any layer can import it.
 */

import type { LocalSyncEngine } from './local-sync-engine.service';

let current: LocalSyncEngine | null = null;

/** Register the engine created at startup. Overwrites any previous one. */
export function setLocalSyncEngine(engine: LocalSyncEngine | null): void {
  current = engine;
}

/** The engine registered at startup, or null before init / in tests. */
export function getLocalSyncEngine(): LocalSyncEngine | null {
  return current;
}
