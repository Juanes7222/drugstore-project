/**
 * Lightweight local import-history store.
 *
 * The server persists DataImport/DataImportRow entities; the POS database
 * schema (packages/database, owned outside pos-desktop) has no equivalent
 * local model, so completed import runs are recorded in localStorage —
 * enough to show the operator what ran, when, and which rows failed,
 * without touching the shared Prisma schema. Not a sync artifact.
 */

import type { ImportHistoryEntry } from "./import.types";

const STORAGE_KEY = "pos-desktop.import-history.v1";
/** Keep only the most recent runs so the key never grows unbounded. */
const MAX_HISTORY_ENTRIES = 50;

function readAll(): ImportHistoryEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ImportHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: ImportHistoryEntry[]): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable (private mode) — history is best-effort
    // and must never fail an import run.
  }
}

/** Record a completed import run. */
export function recordImportHistory(entry: ImportHistoryEntry): void {
  const entries = readAll().filter(
    (existing) => existing.importId !== entry.importId,
  );
  entries.unshift(entry);
  writeAll(entries.slice(0, MAX_HISTORY_ENTRIES));
}

/** List completed import runs, most recent first. */
export function listImportHistory(): ImportHistoryEntry[] {
  return readAll();
}

/** Get a single import run by id, or null. */
export function getImportHistory(importId: string): ImportHistoryEntry | null {
  return readAll().find((entry) => entry.importId === importId) ?? null;
}
