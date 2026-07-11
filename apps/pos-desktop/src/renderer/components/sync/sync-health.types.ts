/**
 * Shared types for the Sync Health feature's presentational components.
 *
 * Re-exported here so that both the wiring container (sync-health.page.tsx)
 * and the presentational components (provided by frontend-pos) reference the
 * same interfaces without circular dependencies or duplication.
 *
 * @module sync-health.types
 */

export type SortField = "lastAttemptAt" | "retryCount" | "operationType";
export type SortDir = "asc" | "desc";

export interface ConnectionStatus {
  type: "reachable" | "unreachable" | "testing" | null;
  message?: string;
}
