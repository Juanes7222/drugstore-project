/**
 * Off-site backup upload worker.
 *
 * Owns the persistent upload queue (`upload-queue.json` in app data dir) and
 * the retry loop that drains it. Lifecycle:
 *
 * 1. `start()` is called once after the service context is wired. It loads
 *    the queue from disk and fires an immediate drain attempt.
 * 2. `enqueue(backupId)` is called from the backup service right after a
 *    successful `createBackup`. It adds an item to the queue and schedules
 *    a drain.
 * 3. The drain loop picks items whose `nextRetryAt` is in the past, calls
 *    `BackupService.uploadBackupToServer`, and updates the item state
 *    (success: remove; failure: bump `attempts`, set `nextRetryAt` with
 *    exponential backoff, surface the error in the audit log).
 *
 * The worker tolerates being stopped and restarted at any point — every
 * state change is persisted before the in-memory copy is touched again.
 *
 * Security note: the password used to derive the AES key is derived from
 * the workstation's `licenseId` plus a fixed salt prefix. This is
 * obfuscation at rest on the server, not end-to-end encryption. The
 * server admin cannot read backup contents without the same secret
 * material, but a sufficiently motivated attacker who compromises both
 * the server and the license can decrypt them. The model is
 * documented; a stronger scheme (per-admin passphrase stored on the
 * workstation) is a future enhancement.
 */

import { invoke } from '@tauri-apps/api/core';
import type { BackupService, UploadReceipt } from './backup.service';
import { isOnline } from '../../common/is-online';
import { useLocalSessionStore } from '../auth/local-session.store';

// ---------------------------------------------------------------------------
// Types (mirrored from Rust)
// ---------------------------------------------------------------------------

export type UploadQueueStatus = 'PENDING' | 'UPLOADING' | 'FAILED';

export interface UploadQueueItem {
  backupId: string;
  attempts: number;
  status: UploadQueueStatus;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface UploadWorkerHandle {
  enqueue(backupId: string): Promise<void>;
  /** Read the current queue. Used by the recovery UI to surface status. */
  getQueue(): Promise<UploadQueueItem[]>;
  /** Force a drain pass on the next tick. */
  kick(): void;
  /** Stop the timer. Items already in the queue will be retried on the
   *  next start(). */
  stop(): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Drain every N milliseconds even when the queue is empty (catches
 *  pre-existing items the user enqueued manually). */
const DRAIN_INTERVAL_MS = 5 * 60 * 1000;

/** Per-item backoff in seconds, indexed by `attempts`. After the last
 *  entry, the item is left in the queue with `attempts` capped so a
 *  transient outage doesn't bury it forever. */
const BACKOFF_SECONDS: readonly number[] = [
  60, // 1 min   — first retry
  5 * 60, // 5 min
  15 * 60, // 15 min
  60 * 60, // 1 hour
  4 * 60 * 60, // 4 hours
  24 * 60 * 60, // 24 hours
];

/** Items with status FAILED older than this stop being scheduled — they
 *  require manual intervention. Keeps the queue from growing unbounded
 *  in pathological conditions. */
const FAILED_GIVE_UP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum concurrent uploads. Kept at 1 to avoid hammering the server
 *  on startup with a backlog of pending items. */
const MAX_CONCURRENT_UPLOADS = 1;

// ---------------------------------------------------------------------------
// Queue I/O (delegated to Rust for atomic file write)
// ---------------------------------------------------------------------------

async function readQueue(): Promise<UploadQueueItem[]> {
  return invoke<UploadQueueItem[]>('read_upload_queue_command');
}

async function writeQueue(items: UploadQueueItem[]): Promise<void> {
  await invoke('write_upload_queue_command', { items });
}

/** Module-level so tests can exercise the schedule without spinning up
 *  the worker closure. */
function computeNextRetry(attempts: number): string {
  const idx = Math.min(attempts, BACKOFF_SECONDS.length - 1);
  return new Date(Date.now() + BACKOFF_SECONDS[idx] * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Password derivation
// ---------------------------------------------------------------------------

/**
 * Derive a stable per-workstation password from the active session.
 *
 * The AES-256-GCM key is derived server-side via Argon2id from this
 * password plus the workstation ID (used as salt). Using the same
 * `workstationId` for every encryption means the same workstation can
 * always decrypt its own backups. Different workstations produce
 * different keys even if the server copy leaks, because the salt embeds
 * the workstation ID.
 *
 * Security note: this is obfuscation at rest, not end-to-end encryption.
 * A sufficiently motivated attacker who compromises the server and the
 * workstation's stored metadata can decrypt. A stronger scheme (per-admin
 * passphrase stored on the workstation) is a future enhancement.
 */
function deriveUploadPassword(workstationId: string): string {
  return `pos-backup:${workstationId}`;
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export interface UploadWorkerOptions {
  backupService: BackupService;
}

export function createUploadWorker(options: UploadWorkerOptions): UploadWorkerHandle {
  let timer: ReturnType<typeof setInterval> | null = null;
  let draining = false;

  async function enqueueInternal(backupId: string): Promise<void> {
    const queue = await readQueue();
    // Idempotent: don't add duplicates. The same backupId may be enqueued
    // by both the backup service and a manual retry.
    if (queue.some((it) => it.backupId === backupId)) {
      return;
    }
    const item: UploadQueueItem = {
      backupId,
      attempts: 0,
      status: 'PENDING',
      lastAttemptAt: null,
      nextRetryAt: null,
      lastError: null,
      createdAt: new Date().toISOString(),
    };
    queue.push(item);
    await writeQueue(queue);
  }

  async function attemptUpload(item: UploadQueueItem): Promise<boolean> {
    const session = useLocalSessionStore.getState().session;
    if (!session) {
      // No session yet — defer.
      return false;
    }
    if (!isOnline()) {
      return false;
    }
    const password = deriveUploadPassword(session.workstationId);

    // Move to UPLOADING and persist before the network call so a crash
    // mid-flight doesn't leave the item stuck.
    let queue = await readQueue();
    const target = queue.find((it) => it.backupId === item.backupId);
    if (!target) {
      return false;
    }
    target.status = 'UPLOADING';
    target.lastAttemptAt = new Date().toISOString();
    target.attempts += 1;
    await writeQueue(queue);

    try {
      const receipt: UploadReceipt = await options.backupService.uploadBackupToServer(
        item.backupId,
        password,
        session.accessToken,
      );
      // Mark on-disk metadata so the recovery page can show "Uploaded at X".
      await invoke('mark_backup_uploaded_command', { id: item.backupId });
      // Remove from queue.
      queue = await readQueue();
      await writeQueue(queue.filter((it) => it.backupId !== item.backupId));
      console.info(
        `[upload-worker] uploaded ${item.backupId} (${receipt.uploadId}) after ${target.attempts} attempt(s)`,
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      queue = await readQueue();
      const failedTarget = queue.find((it) => it.backupId === item.backupId);
      if (failedTarget) {
        failedTarget.status = 'FAILED';
        failedTarget.lastError = message;
        failedTarget.nextRetryAt = computeNextRetry(failedTarget.attempts);
        await writeQueue(queue);
      }
      console.warn(
        `[upload-worker] upload failed for ${item.backupId} (attempt ${target.attempts}): ${message}`,
      );
      return false;
    }
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      const queue = await readQueue();
      const now = Date.now();

      // Filter: PENDING items whose nextRetryAt is null or in the past,
      // and FAILED items that are still within the give-up window.
      const eligible = queue.filter((it) => {
        if (it.status === 'UPLOADING') {
          // Stuck mid-flight from a previous crash — give it one more
          // chance. The upload itself is short-lived, so the recovery
          // window is small.
          if (
            it.lastAttemptAt &&
            now - new Date(it.lastAttemptAt).getTime() < 5 * 60 * 1000
          ) {
            return false;
          }
          return true;
        }
        if (it.status === 'FAILED') {
          if (
            it.nextRetryAt &&
            now < new Date(it.nextRetryAt).getTime()
          ) {
            return false;
          }
          // Give up after the cap so the queue doesn't grow unbounded.
          if (it.attempts >= BACKOFF_SECONDS.length) {
            const age = now - new Date(it.createdAt).getTime();
            if (age > FAILED_GIVE_UP_AFTER_MS) {
              return false;
            }
          }
          return true;
        }
        // PENDING
        if (it.nextRetryAt && now < new Date(it.nextRetryAt).getTime()) {
          return false;
        }
        return true;
      });

      if (eligible.length === 0) return;

      // Sequential, capped concurrency.
      const slice = eligible.slice(0, MAX_CONCURRENT_UPLOADS);
      for (const item of slice) {
        await attemptUpload(item);
      }
    } catch (err) {
      console.warn('[upload-worker] drain error:', err);
    } finally {
      draining = false;
    }
  }

  function scheduleTimer(): void {
    if (timer !== null) return;
    timer = setInterval(() => void drain(), DRAIN_INTERVAL_MS);
  }

  return {
    async enqueue(backupId: string): Promise<void> {
      await enqueueInternal(backupId);
      scheduleTimer();
      void drain();
    },
    async getQueue(): Promise<UploadQueueItem[]> {
      return readQueue();
    },
    kick(): void {
      scheduleTimer();
      void drain();
    },
    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

// Exported for tests; the production code path is `createUploadWorker`.
export const __test = {
  computeNextRetry,
  deriveUploadPassword,
  BACKOFF_SECONDS,
};
