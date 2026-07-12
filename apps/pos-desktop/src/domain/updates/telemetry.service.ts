/**
 * Telemetry service for the POS desktop auto-update module.
 *
 * Batches update-telemetry events and sends them to the server every
 * 5 minutes (or on app close). Events are queued locally in the
 * PendingTelemetry table when offline and flushed when connectivity
 * is restored.
 *
 * Each payload includes an HMAC signature derived from license data
 * for authenticity verification by the server.
 */

import { isOnline } from '../../common/is-online';
import { API_BASE_URL } from '../../infrastructure/config';
import { UpdateOutcome } from '@pharmacy/shared-types';
import type { UpdateTelemetryPayload } from '@pharmacy/shared-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelemetryEvent {
  /** Workstation identifier. */
  workstationId: string;
  /** License identifier. */
  licenseId: string;
  /** Version the terminal is updating from. */
  fromVersion: string;
  /** Version the terminal is updating to (null for checks). */
  toVersion: string | null;
  /** Unique attempt identifier for deduplication. */
  attemptId: string;
  /** Outcome code. */
  outcome: UpdateOutcome;
  /** Optional error message. */
  errorMessage?: string;
  /** Duration in milliseconds (e.g. download time, install time). */
  durationMs?: number;
}

export interface TelemetryServiceConfig {
  /** PrismaClient for local DB access. */
  prisma: unknown;
  /** Workstation identifier. */
  workstationId: string;
  /** Access token for API authentication. */
  accessToken?: () => Promise<string | null>;
}

export interface TelemetryService {
  /**
   * Enqueue a telemetry event for batched delivery.
   * The event is written to the local PendingTelemetry table immediately
   * and flushed on the next batch cycle or explicit flush call.
   */
  enqueue(event: TelemetryEvent): Promise<void>;

  /**
   * Flush all pending telemetry events to the server.
   * Called periodically (every 5 minutes) and on app close.
   */
  flush(): Promise<void>;

  /**
   * Start the periodic flush interval.
   */
  start(): void;

  /**
   * Stop the periodic flush interval. Call during app teardown.
   */
  stop(): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTelemetryService(
  config: TelemetryServiceConfig,
): TelemetryService {
  return new TelemetryServiceImpl(config);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class TelemetryServiceImpl implements TelemetryService {
  private timerId: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(private readonly config: TelemetryServiceConfig) {}

  async enqueue(event: TelemetryEvent): Promise<void> {
    const db = this.config.prisma as any;

    // Derive HMAC signature (placeholder — in production, use key from license)
    const signature = await this.computeSignature(event);

    const payload: UpdateTelemetryPayload = {
      workstationId: event.workstationId,
      licenseId: event.licenseId,
      fromVersion: event.fromVersion,
      toVersion: event.toVersion,
      attemptId: event.attemptId,
      outcome: event.outcome,
      errorMessage: event.errorMessage,
      durationMs: event.durationMs,
      occurredAt: new Date().toISOString(),
      signature,
    };

    await db.pendingTelemetry.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        endpoint: '/updates/telemetry',
        body: JSON.stringify(payload),
        createdAt: new Date(),
        retryCount: 0,
        lastError: null,
      },
    });

    // If online and no flush is scheduled, schedule an immediate flush
    if (isOnline() && this.timerId === null) {
      // Don't flush immediately — wait for the next cycle or explicit flush.
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    if (!isOnline()) return;

    this.flushing = true;

    try {
      const db = this.config.prisma as any;

      while (true) {
        const batch = await db.pendingTelemetry.findMany({
          orderBy: { createdAt: 'asc' },
          take: BATCH_SIZE,
        });

        if (batch.length === 0) break;

        const bodies = batch.map((row: { body: string }) => JSON.parse(row.body) as UpdateTelemetryPayload);

        try {
          const baseUrl = API_BASE_URL.replace(/\/$/, '');
          const accessToken = this.config.accessToken
            ? await this.config.accessToken()
            : null;

          const response = await fetch(`${baseUrl}/updates/telemetry`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify({ events: bodies }),
          });

          if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
          }

          // Delete successfully sent events
          const ids = batch.map((r: { id: string }) => r.id);
          await db.pendingTelemetry.deleteMany({
            where: { id: { in: ids } },
          });
        } catch (err) {
          // Increment retry count for all events in this batch
          const ids = batch.map((r: { id: string }) => r.id);
          const errorMessage = err instanceof Error ? err.message : String(err);

          await db.pendingTelemetry.updateMany({
            where: { id: { in: ids } },
            data: {
              retryCount: { increment: 1 },
              lastError: errorMessage,
            },
          });

          // Stop flushing on first failure — will retry next cycle.
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  start(): void {
    if (this.timerId !== null) return;

    this.timerId = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    // Flush remaining events synchronously (best-effort)
    void this.flush();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Compute an HMAC signature for the telemetry payload.
   *
   * Uses the Web Crypto API with a key derived from license data.
   * In this initial implementation we use a placeholder key; production
   * deployments must derive the key from the workstation's license
   * activation secret.
   */
  private async computeSignature(event: TelemetryEvent): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(
      `${event.workstationId}:${event.attemptId}:${event.outcome}:${event.fromVersion}`,
    );

    // Derive key from a combination of license data and workstation identity.
    // The actual key derivation should use the license activation code.
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(
        `pharmacy-pos-telemetry-key-${event.workstationId}-${event.licenseId}`,
      ),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const signature = await crypto.subtle.sign('HMAC', keyMaterial, data);
    const hashArray = Array.from(new Uint8Array(signature));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}
