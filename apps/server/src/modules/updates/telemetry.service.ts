import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { SignatureService } from './signature.service';
import { InvalidSignatureException } from './exceptions/invalid-signature.exception';
import { UpdateOutcome } from '@pharmacy/shared-types';
import type { UpdateTelemetryInput } from './dto';

/** Outcome of ingesting one event inside a batch flush. */
export const TELEMETRY_INGEST_STATUS = {
  ACCEPTED: 'ACCEPTED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
} as const;

export type TelemetryIngestStatus =
  (typeof TELEMETRY_INGEST_STATUS)[keyof typeof TELEMETRY_INGEST_STATUS];

export interface TelemetryEventIngestResult {
  attemptId: string;
  status: TelemetryIngestStatus;
}

/**
 * The schema's outcome literal union mirrors UpdateOutcome value-for-value,
 * so internal counters are keyed on it instead of on the (nominal) enum.
 */
type TelemetryOutcome = UpdateTelemetryInput['outcome'];

/**
 * Ingest and aggregate update telemetry from POS workstations.
 *
 * Validates the HMAC signature on each inbound event, persists it to the
 * UpdateAttemptLog table, and maintains in-memory aggregates for fast
 * admin-dashboard queries. Ingestion is idempotent per attemptId because
 * the workstation's offline queue guarantees retries.
 */
@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  /** In-memory aggregate counters. */
  private aggregates = {
    totalAttempts: 0,
    successCount: 0,
    failureCount: 0,
    rollbackCount: 0,
    byOutcome: new Map<TelemetryOutcome, number>(),
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly signatureService: SignatureService,
  ) {}

  /**
   * Ingest a single telemetry event from a workstation.
   * Returns the created UpdateAttemptLog entry, or throws on invalid signature.
   */
  async ingestTelemetry(data: UpdateTelemetryInput): Promise<unknown> {
    this.verifySignatureOrThrow(data);

    const { attempt, created } = await this.persistEvent(data);
    if (created) {
      this.recordAggregates(data.outcome);
    }
    return attempt;
  }

  /**
   * Ingest a batch of telemetry events from one queue flush. Each event is
   * verified and persisted independently so one bad event cannot block the
   * rest; per-event results let the caller see what was accepted. A transient
   * persistence error bubbles up so the client retries the whole batch —
   * safe because ingestion is idempotent per attemptId.
   */
  async ingestTelemetryBatch(
    events: UpdateTelemetryInput[],
  ): Promise<TelemetryEventIngestResult[]> {
    return Promise.all(events.map((event) => this.ingestBatchedEvent(event)));
  }

  /**
   * Get success rate for a given version in the last N hours.
   */
  async getVersionSuccessRate(
    versionId: string,
    sinceHours: number = 24,
  ): Promise<{ successRate: number; totalInstalls: number; totalRollbacks: number }> {
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

    const [installs, rollbacks] = await Promise.all([
      this.prisma.updateAttemptLog.count({
        where: {
          versionId,
          occurredAt: { gte: since },
          outcome: { in: ['INSTALL_COMPLETED', 'RESTARTED_OK'] as any[] },
        },
      }),
      this.prisma.updateAttemptLog.count({
        where: {
          versionId,
          occurredAt: { gte: since },
          outcome: 'ROLLED_BACK' as any,
        },
      }),
    ]);

    const total = installs + rollbacks;
    return {
      successRate: total > 0 ? installs / total : 1,
      totalInstalls: installs,
      totalRollbacks: rollbacks,
    };
  }

  /**
   * Count unique workstations that have installed a given version.
   */
  async countUniqueWorkstationsInstalled(
    versionId: string,
  ): Promise<number> {
    const result = await this.prisma.updateAttemptLog.findMany({
      where: {
        versionId,
        outcome: { in: ['INSTALL_COMPLETED', 'RESTARTED_OK'] as any[] },
      },
      select: { workstationId: true },
      distinct: ['workstationId'],
    });
    return result.length;
  }

  /**
   * Get error breakdown for a version.
   */
  async getErrorBreakdown(
    versionId: string,
  ): Promise<Array<{ outcome: string; count: number; sampleError: string | null }>> {
    const rows = await this.prisma.updateAttemptLog.groupBy({
      by: ['outcome', 'errorMessage'],
      where: { versionId },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    const breakdown = new Map<string, { count: number; sampleError: string | null }>();
    for (const row of rows) {
      const key = row.outcome;
      const existing = breakdown.get(key) ?? { count: 0, sampleError: null };
      existing.count += row._count.id;
      if (!existing.sampleError && row.errorMessage) {
        existing.sampleError = row.errorMessage;
      }
      breakdown.set(key, existing);
    }

    return Array.from(breakdown.entries()).map(([outcome, data]) => ({
      outcome,
      count: data.count,
      sampleError: data.sampleError,
    }));
  }

  /**
   * Get all failed workstations for a version.
   */
  async getFailedWorkstations(
    versionId: string,
  ): Promise<Array<{ workstationId: string; errorMessage: string | null }>> {
    const failedAttempts = await this.prisma.updateAttemptLog.findMany({
      where: {
        versionId,
        outcome: { in: ['INSTALL_FAILED', 'MIGRATION_FAILED', 'ROLLED_BACK'] as any[] },
      },
      select: { workstationId: true, errorMessage: true },
      distinct: ['workstationId'],
      orderBy: { occurredAt: 'desc' },
    });

    return failedAttempts.map((a) => ({
      workstationId: a.workstationId,
      errorMessage: a.errorMessage,
    }));
  }

  /** Get the current aggregate counters (for admin dashboard). */
  getAggregates() {
    return this.aggregates;
  }

  private verifySignatureOrThrow(data: UpdateTelemetryInput): void {
    // The HMAC covers only the base fields; errorMessage/durationMs are not
    // signed by design and stay out of the payload-to-sign.
    const payloadToSign = [
      data.workstationId,
      data.licenseId,
      data.fromVersion,
      data.toVersion ?? '',
      data.attemptId,
      data.outcome,
      data.occurredAt,
    ].join('|');

    if (
      !this.signatureService.verifyTelemetrySignature(
        payloadToSign,
        data.signature,
        data.licenseId,
      )
    ) {
      throw new InvalidSignatureException();
    }
  }

  /**
   * Resolve toVersion to an UpdateVersion row id, or null when the event has
   * no target version or references one unknown to the server yet.
   */
  private async resolveVersionId(
    toVersion: string | null | undefined,
  ): Promise<string | null> {
    if (!toVersion) {
      return null;
    }
    const version = await this.prisma.updateVersion.findFirst({
      where: { version: toVersion },
      orderBy: { releaseDate: 'desc' },
      select: { id: true },
    });
    return version?.id ?? null;
  }

  /**
   * Persist one signature-verified event. A P2002 (duplicate attemptId)
   * means the offline queue replayed an already-persisted event: return the
   * existing row as not-created instead of failing the ingest.
   */
  private async persistEvent(
    data: UpdateTelemetryInput,
  ): Promise<{ attempt: unknown; created: boolean }> {
    const versionId = await this.resolveVersionId(data.toVersion);

    try {
      const attempt = await this.prisma.updateAttemptLog.create({
        data: {
          id: data.attemptId,
          versionId: versionId ?? '__unknown__',
          workstationId: data.workstationId,
          licenseId: data.licenseId,
          fromVersion: data.fromVersion,
          toVersion: data.toVersion ?? null,
          outcome: data.outcome as any,
          errorMessage: data.errorMessage,
          durationMs: data.durationMs,
          occurredAt: new Date(data.occurredAt),
        },
      });
      return { attempt, created: true };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const existing = await this.prisma.updateAttemptLog.findUnique({
          where: { id: data.attemptId },
        });
        return { attempt: existing, created: false };
      }
      throw error;
    }
  }

  private recordAggregates(outcome: TelemetryOutcome): void {
    this.aggregates.totalAttempts++;
    this.aggregates.byOutcome.set(
      outcome,
      (this.aggregates.byOutcome.get(outcome) ?? 0) + 1,
    );

    if (
      outcome === UpdateOutcome.INSTALL_COMPLETED ||
      outcome === UpdateOutcome.RESTARTED_OK
    ) {
      this.aggregates.successCount++;
    } else if (
      outcome === UpdateOutcome.INSTALL_FAILED ||
      outcome === UpdateOutcome.MIGRATION_FAILED
    ) {
      this.aggregates.failureCount++;
    } else if (outcome === UpdateOutcome.ROLLED_BACK) {
      this.aggregates.rollbackCount++;
    }
  }

  private async ingestBatchedEvent(
    event: UpdateTelemetryInput,
  ): Promise<TelemetryEventIngestResult> {
    try {
      await this.ingestTelemetry(event);
      return {
        attemptId: event.attemptId,
        status: TELEMETRY_INGEST_STATUS.ACCEPTED,
      };
    } catch (error) {
      // A poisoned event can never succeed on retry, so report it instead of
      // failing the whole flush forever. Anything else (e.g. DB outage)
      // propagates so the queue retries the batch.
      if (error instanceof InvalidSignatureException) {
        return {
          attemptId: event.attemptId,
          status: TELEMETRY_INGEST_STATUS.INVALID_SIGNATURE,
        };
      }
      throw error;
    }
  }
}
