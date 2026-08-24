/**
 * Audits the per-workstation sale numbering sequence (localNumber).
 *
 * Every sale a POS creates — confirmed, annulled, or still in progress —
 * occupies one localNumber in its workstation's 1..N sequence. A missing
 * number is therefore evidence of a lost or locally-discarded movement,
 * which for fiscal purposes must be detected, never silently accepted.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

/** Hard cap on reported gaps so a corrupted workstation cannot flood the response. */
const MAX_REPORTED_GAPS = 200;

export interface WorkstationSequenceSummary {
  sourceWorkstationId: string;
  /** BigInt serialized as string. */
  minLocalNumber: string;
  maxLocalNumber: string;
  saleCount: number;
  /** max - min + 1 - count: how many numbers in the range have no sale row. */
  holeCount: number;
}

export interface SequenceGap {
  sourceWorkstationId: string;
  /** BigInt serialized as string. */
  localNumber: string;
}

@Injectable()
export class SaleSequenceAuditService {
  private readonly logger = new Logger(SaleSequenceAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Per-workstation summary of the localNumber range. Cheap (single
   * groupBy) — suitable for dashboards; use `findGaps` for the detail.
   */
  async getSummaries(): Promise<WorkstationSequenceSummary[]> {
    const rows = await this.prisma.sale.groupBy({
      by: ['sourceWorkstationId'],
      _count: { localNumber: true },
      _min: { localNumber: true },
      _max: { localNumber: true },
    });

    return rows.map((row) => {
      // Defensive: a synthetic/empty group (no rows) has no range to hole-count.
      if (row._min.localNumber === null || row._max.localNumber === null) {
        return {
          sourceWorkstationId: row.sourceWorkstationId,
          minLocalNumber: '0',
          maxLocalNumber: '0',
          saleCount: row._count.localNumber,
          holeCount: 0,
        };
      }
      const min = row._min.localNumber;
      const max = row._max.localNumber;
      const expected = max >= min ? max - min + 1n : 0n;
      return {
        sourceWorkstationId: row.sourceWorkstationId,
        minLocalNumber: min.toString(),
        maxLocalNumber: max.toString(),
        saleCount: row._count.localNumber,
        // Numbering is expected to start at 1; holes below `min` are
        // counted by findGaps, which scans from 1.
        holeCount: Number(expected - BigInt(row._count.localNumber)),
      };
    });
  }

  /**
   * Lists every missing localNumber per workstation, scanning each
   * workstation's sequence from 1. Truncates at MAX_REPORTED_GAPS with a
   * logged warning rather than returning an unbounded payload.
   */
  async findGaps(workstationId?: string): Promise<SequenceGap[]> {
    const sales = await this.prisma.sale.findMany({
      where: workstationId ? { sourceWorkstationId: workstationId } : {},
      select: { sourceWorkstationId: true, localNumber: true },
      orderBy: [{ sourceWorkstationId: 'asc' }, { localNumber: 'asc' }],
    });

    const nextExpectedByWorkstation = new Map<string, bigint>();
    const gaps: SequenceGap[] = [];

    for (const sale of sales) {
      const expected = nextExpectedByWorkstation.get(sale.sourceWorkstationId) ?? 1n;
      const current = sale.localNumber;

      if (current > expected && gaps.length < MAX_REPORTED_GAPS) {
        for (let missing = expected; missing < current; missing += 1n) {
          if (gaps.length >= MAX_REPORTED_GAPS) break;
          gaps.push({
            sourceWorkstationId: sale.sourceWorkstationId,
            localNumber: missing.toString(),
          });
        }
      }

      if (current >= expected) {
        nextExpectedByWorkstation.set(sale.sourceWorkstationId, current + 1n);
      }
    }

    if (gaps.length >= MAX_REPORTED_GAPS) {
      this.logger.warn(
        `Sale sequence gap scan truncated at ${MAX_REPORTED_GAPS} entries`,
      );
    }
    return gaps;
  }
}
