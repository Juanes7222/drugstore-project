import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { SignatureService } from './signature.service';
import { InvalidSignatureException } from './exceptions/invalid-signature.exception';
import { UpdateOutcome } from '@pharmacy/shared-types';

/**
 * Ingest and aggregate update telemetry from POS workstations.
 *
 * Validates the HMAC signature on each inbound event, persists it to the
 * UpdateAttemptLog table, and maintains in-memory aggregates for fast
 * admin-dashboard queries.
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
    byOutcome: new Map<UpdateOutcome, number>(),
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly signatureService: SignatureService,
  ) {}

  /**
   * Ingest a telemetry event from a workstation.
   * Returns the created UpdateAttemptLog entry, or throws on invalid signature.
   */
  async ingestTelemetry(data: {
    workstationId: string;
    licenseId: string;
    fromVersion: string;
    toVersion: string | null;
    attemptId: string;
    outcome: UpdateOutcome;
    errorMessage?: string;
    durationMs?: number;
    occurredAt: string;
    signature: string;
  }): Promise<unknown> {
    // Verify the HMAC signature
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

    // Find the UpdateVersion for this toVersion
    let versionId: string | null = null;
    if (data.toVersion) {
      const version = await this.prisma.updateVersion.findFirst({
        where: { version: data.toVersion },
        orderBy: { releaseDate: 'desc' },
        select: { id: true },
      });
      versionId = version?.id ?? null;
    }

    const attempt = await this.prisma.updateAttemptLog.create({
      data: {
        id: data.attemptId,
        versionId: versionId ?? '__unknown__',
        workstationId: data.workstationId,
        licenseId: data.licenseId,
        fromVersion: data.fromVersion,
        toVersion: data.toVersion,
        outcome: data.outcome as any,
        errorMessage: data.errorMessage,
        durationMs: data.durationMs,
        occurredAt: new Date(data.occurredAt),
      },
    });

    // Update in-memory aggregates
    this.aggregates.totalAttempts++;
    this.aggregates.byOutcome.set(
      data.outcome,
      (this.aggregates.byOutcome.get(data.outcome) ?? 0) + 1,
    );

    if (
      data.outcome === UpdateOutcome.INSTALL_COMPLETED ||
      data.outcome === UpdateOutcome.RESTARTED_OK
    ) {
      this.aggregates.successCount++;
    } else if (
      data.outcome === UpdateOutcome.INSTALL_FAILED ||
      data.outcome === UpdateOutcome.MIGRATION_FAILED
    ) {
      this.aggregates.failureCount++;
    } else if (data.outcome === UpdateOutcome.ROLLED_BACK) {
      this.aggregates.rollbackCount++;
    }

    return attempt;
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
}
