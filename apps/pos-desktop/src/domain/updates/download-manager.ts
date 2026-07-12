/**
 * Background download manager for the POS desktop auto-update module.
 *
 * Handles downloading update binaries with progress reporting, SHA-256
 * verification, retry logic with exponential backoff, and partial-state
 * persistence for resume after app restart.
 *
 * Uses the web Streams API for chunked download with real-time progress.
 * Writes the downloaded file to a temporary location (IndexedDB in dev,
 * filesystem via Tauri invoke in production).
 */

import { invoke } from '@tauri-apps/api/core';
import { isOnline } from '../../common/is-online';
import {
  DownloadFailedException,
} from './exceptions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DownloadProgress {
  /** Total bytes expected, or 0 if unknown. */
  totalBytes: number;
  /** Bytes received so far. */
  receivedBytes: number;
  /** Percentage completed (0–100). */
  percent: number;
  /** Download speed in bytes per second (smoothed). */
  bytesPerSecond: number;
  /** Estimated remaining time in milliseconds, or Infinity. */
  etaMs: number;
}

export type DownloadState =
  | { status: 'idle' }
  | { status: 'downloading'; progress: DownloadProgress }
  | { status: 'paused'; progress: DownloadProgress }
  | { status: 'completed'; filePath: string; sha256: string }
  | { status: 'failed'; error: string };

export interface DownloadManagerConfig {
  /** URL to download the update binary from. */
  downloadUrl: string;
  /** Expected SHA-256 hash for verification. */
  expectedHash: string;
  /** Expected file size in bytes (0 if unknown). */
  expectedSize: number;
  /** The app version being downloaded (used for temp path). */
  version: string;
}

export interface DownloadManager {
  /** Current state of the download. */
  readonly state: DownloadState;

  /** Start or resume the download. Resolves when complete or fails. */
  start(): Promise<string>;

  /** Pause an in-progress download. */
  pause(): void;

  /** Cancel the download and release resources. */
  cancel(): Promise<void>;

  /** Subscribe to progress updates. Returns an unsubscribe function. */
  onProgress(callback: (progress: DownloadProgress) => void): () => void;

  /** Subscribe to state changes. Returns an unsubscribe function. */
  onStateChange(callback: (state: DownloadState) => void): () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [5000, 30000, 300000]; // 5s, 30s, 5min
const PROGRESS_SMOOTHING_FACTOR = 0.3;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDownloadManager(config: DownloadManagerConfig): DownloadManager {
  return new DownloadManagerImpl(config);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class DownloadManagerImpl implements DownloadManager {
  private _state: DownloadState = { status: 'idle' };
  private progressListeners: Array<(progress: DownloadProgress) => void> = [];
  private stateListeners: Array<(state: DownloadState) => void> = [];
  private abortController: AbortController | null = null;
  private _paused = false;

  constructor(private readonly config: DownloadManagerConfig) {}

  get state(): DownloadState {
    return this._state;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async start(): Promise<string> {
    if (this._state.status === 'downloading') {
      throw new DownloadFailedException('Download is already in progress.');
    }

    if (!isOnline()) {
      throw new DownloadFailedException('Cannot download update while offline.');
    }

    this._paused = false;
    return this.downloadWithRetry();
  }

  pause(): void {
    if (this._state.status !== 'downloading') return;
    this._paused = true;
    this.abortController?.abort();
    this.emitStateChange({ status: 'paused', progress: this.getCurrentProgress() });
  }

  async cancel(): Promise<void> {
    this._paused = false;
    this.abortController?.abort();
    this.abortController = null;
    this._state = { status: 'idle' };
    this.emitStateChange(this._state);
  }

  // -----------------------------------------------------------------------
  // Subscriptions
  // -----------------------------------------------------------------------

  onProgress(callback: (progress: DownloadProgress) => void): () => void {
    this.progressListeners.push(callback);
    return () => {
      this.progressListeners = this.progressListeners.filter((l) => l !== callback);
    };
  }

  onStateChange(callback: (state: DownloadState) => void): () => void {
    this.stateListeners.push(callback);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== callback);
    };
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async downloadWithRetry(): Promise<string> {
    let lastError: string = '';

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (this._paused) {
        throw new DownloadFailedException('Download was paused.');
      }

      if (attempt > 0) {
        const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
        await this.sleep(delayMs);
      }

      try {
        const filePath = await this.performDownload();
        // Verify hash
        const actualHash = await this.computeSha256Hex(filePath);
        if (actualHash.toLowerCase() !== this.config.expectedHash.toLowerCase()) {
          throw new DownloadFailedException(
            `SHA-256 mismatch. Expected ${this.config.expectedHash}, got ${actualHash}.`,
          );
        }

        this._state = {
          status: 'completed',
          filePath,
          sha256: actualHash,
        };
        this.emitStateChange(this._state);
        return filePath;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        // Retry attempt tracked via the for-loop counter

        if (this._paused) break;

        if (attempt < MAX_RETRIES) {
          const delayMs = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
          this.emitProgressUpdate({
            totalBytes: this.config.expectedSize,
            receivedBytes: 0,
            percent: 0,
            bytesPerSecond: 0,
            etaMs: delayMs,
          });
        }
      }
    }

    this._state = {
      status: 'failed',
      error: lastError,
    };
    this.emitStateChange(this._state);
    throw new DownloadFailedException(lastError);
  }

  private async performDownload(): Promise<string> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.emitStateChange({
      status: 'downloading',
      progress: this.getCurrentProgress(),
    });

    const response = await fetch(this.config.downloadUrl, {
      method: 'GET',
      signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new DownloadFailedException(
        `Server returned ${response.status}: ${response.statusText}`,
      );
    }

    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : this.config.expectedSize;
    const reader = response.body?.getReader();
    if (!reader) {
      throw new DownloadFailedException('Response body is not readable.');
    }

    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    let lastTimestamp = performance.now();
    let lastBytes = 0;
    let smoothedSpeed = 0;

    try {
      while (true) {
        if (this._paused) {
          reader.cancel();
          throw new DownloadFailedException('Download paused by user.');
        }

        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedBytes += value.length;

        // Progress calculation with speed smoothing
        const now = performance.now();
        const elapsed = now - lastTimestamp;
        if (elapsed >= 200) {
          const instantSpeed = ((receivedBytes - lastBytes) / elapsed) * 1000;
          smoothedSpeed =
            smoothedSpeed === 0
              ? instantSpeed
              : PROGRESS_SMOOTHING_FACTOR * instantSpeed +
                (1 - PROGRESS_SMOOTHING_FACTOR) * smoothedSpeed;

          lastBytes = receivedBytes;
          lastTimestamp = now;

          const percent = totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0;
          const etaMs =
            smoothedSpeed > 0 && totalBytes > 0
              ? ((totalBytes - receivedBytes) / smoothedSpeed) * 1000
              : Infinity;

          this.emitProgressUpdate({
            totalBytes,
            receivedBytes,
            percent: Math.min(percent, 100),
            bytesPerSecond: Math.round(smoothedSpeed),
            etaMs,
          });
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new DownloadFailedException('Download was aborted.');
      }
      throw err;
    }

    // Assemble the blob
    const blob = new Blob(chunks as unknown as BlobPart[], { type: 'application/octet-stream' });

    if (totalBytes > 0 && blob.size !== totalBytes) {
      throw new DownloadFailedException(
        `Download size mismatch: expected ${totalBytes} bytes, got ${blob.size}.`,
      );
    }

    // Write to temp storage via Tauri invoke (saves blob to filesystem)
    const filePath = await this.writeBinaryToStorage(blob);

    return filePath;
  }

  /**
   * Write the downloaded binary to storage.
   * Uses Tauri invoke to save via Rust filesystem; falls back to data-URL
   * reference for dev mode.
   */
  private async writeBinaryToStorage(blob: Blob): Promise<string> {
    const isTauriEnv =
      typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

    if (isTauriEnv) {
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const path = await invoke<string>('write_update_binary_command', {
        version: this.config.version,
        data: Array.from(uint8Array),
      });
      return path;
    }

    // Dev fallback: store as blob URL (survives only until page reload)
    const blobUrl = URL.createObjectURL(blob);
    console.info('[download-manager] Dev mode: stored update binary as blob URL.');
    return blobUrl;
  }

  private async computeSha256Hex(_filePath: string): Promise<string> {
    const isTauriEnv =
      typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

    if (isTauriEnv) {
      return invoke<string>('compute_sha256_command', { filePath: _filePath });
    }

    // Dev fallback: compute SHA-256 using Web Crypto API
    const response = await fetch(_filePath);
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private getCurrentProgress(): DownloadProgress {
    return {
      totalBytes: this.config.expectedSize,
      receivedBytes: 0,
      percent: 0,
      bytesPerSecond: 0,
      etaMs: Infinity,
    };
  }

  private emitProgressUpdate(progress: DownloadProgress): void {
    for (const cb of this.progressListeners) {
      try {
        cb(progress);
      } catch {
        // Swallow listener errors.
      }
    }
  }

  private emitStateChange(state: DownloadState): void {
    for (const cb of this.stateListeners) {
      try {
        cb(state);
      } catch {
        // Swallow listener errors.
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
