/**
 * Local data-freshness service.
 *
 * Computes the `ReportFreshness` payload that the report header renders
 * to disclose which workstation database the report was generated from,
 * when the last sync completed, and how many operations are still
 * pending or in permanent failure.
 */

import type { PrismaClient } from '@pharmacy/database/local';
import { buildPendingOpsCountQuery } from './report-query-builders';
import type { ReportFreshness } from './report-types';
import { dbWriteLock } from '../../infrastructure/write-lock';

interface PendingOpsRow {
  pending: number;
  permanent_failures: number;
  max_seq: string | null;
  last_completed_at: Date | null;
  last_failed_at: Date | null;
}

export class ReportFreshnessService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Snapshot the local database freshness. */
  async snapshot(): Promise<ReportFreshness> {
    // The query is read-only; do not acquire the write lock.  PGlite
    // serves concurrent reads on its single connection.
    void dbWriteLock; // reference so unused-import lints stay quiet.
    const row = (await this.prisma.$queryRawUnsafe<PendingOpsRow[]>(
      buildPendingOpsCountQuery().sql,
    ))?.[0];

    const pending = Number(row?.pending ?? 0);
    const permanentFailures = Number(row?.permanent_failures ?? 0);
    const dbRevision = row?.max_seq ?? '0';
    const lastSyncAt = row?.last_completed_at
      ? new Date(row.last_completed_at).toISOString()
      : null;
    const lastSyncSuccessful = !!row?.last_completed_at && !row?.last_failed_at;

    return {
      dataSource: 'local-workstation',
      generatedAt: new Date().toISOString(),
      lastSyncAt,
      pendingOperations: pending,
      permanentFailures,
      lastSyncSuccessful,
      dbRevision,
    };
  }
}
