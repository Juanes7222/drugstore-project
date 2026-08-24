/**
 * Cross-system integrity verification for the offline sync pipeline.
 *
 * The POS can locally discard queued operations, and a discarded sale
 * leaves a hole in the workstation's localNumber sequence that the server
 * would never learn about on its own. This service closes that gap: it
 * diffs the client's reported ledger against what the server actually
 * accepted, and audits the per-workstation sale numbering for holes.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { SyncStatus } from '@pharmacy/database';
import {
  SaleSequenceAuditService,
  SequenceGap,
  WorkstationSequenceSummary,
} from '@/modules/sales-pos/services/sale-sequence-audit.service';
import type { LedgerVerifyRequestDto } from '../dto/ledger-verify.dto';

/** Bounded problem-entry list so the report stays renderable. */
const MAX_PROBLEM_ENTRIES = 50;

const PROBLEM_STATUSES: SyncStatus[] = ['FAILED', 'PERMANENT_FAILURE'];

export type LedgerVerdict =
  | 'OK'
  | 'NOT_SUBMITTED'
  | 'NOT_ACCEPTED'
  | 'STATUS_MISMATCH';

export interface LedgerVerdictResult {
  operationUuid: string;
  verdict: LedgerVerdict;
  clientStatus: string;
  serverStatus: string | null;
}

export interface LedgerVerifyResponse {
  checkedAt: Date;
  results: LedgerVerdictResult[];
  summary: Record<LedgerVerdict, number>;
}

export interface IntegrityProblemEntry {
  operationUuid: string;
  operationType: string;
  status: string;
  retryCount: number;
  lastErrorMessage: string | null;
  receivedAt: Date | null;
}

export interface IntegrityReport {
  generatedAt: Date;
  queueByStatus: Record<string, number>;
  problems: IntegrityProblemEntry[];
  /** Total problem entries; `problems` may be a truncated view. */
  problemsTotal: number;
  sequenceSummaries: WorkstationSequenceSummary[];
  sequenceGaps: SequenceGap[];
}

const VERDICTS: LedgerVerdict[] = ['OK', 'NOT_SUBMITTED', 'NOT_ACCEPTED', 'STATUS_MISMATCH'];

@Injectable()
export class SyncIntegrityService {
  private readonly logger = new Logger(SyncIntegrityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceAudit: SaleSequenceAuditService,
  ) {}

  /**
   * Diffs the client-reported operations against server queue state.
   *
   * Verdicts:
   * - OK: both sides agree the operation completed.
   * - NOT_SUBMITTED: the uuid is unknown to the server — the client holds
   *   (or discarded) a movement the server never received.
   * - NOT_ACCEPTED: the client believes it synced, but the server has the
   *   entry in a non-completed state — the movement is NOT durable
   *   server-side despite local UI claiming otherwise.
   * - STATUS_MISMATCH: any other client/server state disagreement.
   */
  async verifyLedger(request: LedgerVerifyRequestDto): Promise<LedgerVerifyResponse> {
    const uuids = request.operations.map((op) => op.operationUuid);

    const serverRows = await this.prisma.syncQueue.findMany({
      where: { operationUuid: { in: uuids } },
      select: { operationUuid: true, status: true },
    });
    const serverByUuid = new Map(serverRows.map((row) => [row.operationUuid, row.status]));

    const results: LedgerVerdictResult[] = request.operations.map((op) => {
      const serverStatus = serverByUuid.get(op.operationUuid) ?? null;
      let verdict: LedgerVerdict;

      if (serverStatus === null) {
        verdict = 'NOT_SUBMITTED';
      } else if (op.status === 'SYNCED' && serverStatus === SyncStatus.COMPLETED) {
        verdict = 'OK';
      } else if (op.status === 'SYNCED' && serverStatus !== SyncStatus.COMPLETED) {
        // A locally "synced" movement that the server has not completed is
        // the worst case: the POS will eventually forget it while the
        // server-side data hole remains.
        verdict = 'NOT_ACCEPTED';
      } else {
        // Any other disagreement — including a locally-DISCARDED operation
        // the server knows about. Discards are integrity violations to
        // investigate, not a legitimate terminal state.
        verdict = 'STATUS_MISMATCH';
      }

      return {
        operationUuid: op.operationUuid,
        verdict,
        clientStatus: op.status,
        serverStatus,
      };
    });

    const summary = Object.fromEntries(
      VERDICTS.map((verdict) => [verdict, 0]),
    ) as Record<LedgerVerdict, number>;
    for (const result of results) {
      summary[result.verdict] += 1;
    }

    return { checkedAt: new Date(), results, summary };
  }

  /**
   * Server-side integrity view: queue health, unresolved entries, and
   * per-workstation sale numbering holes.
   */
  async getReport(workstationId?: string): Promise<IntegrityReport> {
    const [statusGroups, problemTotal, problems, sequenceSummaries] = await Promise.all([
      this.prisma.syncQueue.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.syncQueue.count({ where: { status: { in: PROBLEM_STATUSES } } }),
      this.prisma.syncQueue.findMany({
        where: { status: { in: PROBLEM_STATUSES } },
        select: {
          operationUuid: true,
          operationType: true,
          status: true,
          retryCount: true,
          lastErrorMessage: true,
          receivedAt: true,
        },
        orderBy: { receivedAt: 'desc' },
        take: MAX_PROBLEM_ENTRIES,
      }),
      this.sequenceAudit.getSummaries(),
    ]);

    const queueByStatus: Record<string, number> = {};
    for (const group of statusGroups) {
      queueByStatus[group.status] = group._count._all;
    }

    // Gap detail is the expensive scan — run it only when summaries show
    // holes or when a specific workstation was requested.
    const hasHoles = sequenceSummaries.some((summary) => summary.holeCount > 0);
    const sequenceGaps =
      workstationId || hasHoles ? await this.sequenceAudit.findGaps(workstationId) : [];

    return {
      generatedAt: new Date(),
      queueByStatus,
      problems,
      problemsTotal: problemTotal,
      sequenceSummaries,
      sequenceGaps,
    };
  }
}
