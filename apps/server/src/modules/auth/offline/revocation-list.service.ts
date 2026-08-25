/**
 * Revocation list service.
 *
 * Manages the list of revoked offline tokens. The POS downloads this list
 * periodically to invalidate cached offline sessions. Supports delta fetches
 * via the `since` parameter.
 *
 * Urgent revocations (stolen workstation, disabled user) are also pushed
 * via the sync response so the POS picks them up immediately.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { AuditService, AuditEvent } from '../services/audit.service';
import { paginateWithCursor } from '@/common/utils/cursor-pagination';

export interface RevocationListEntry {
  jti: string;
  revokedAt: Date;
  reason: string;
}

export interface RevocationListResult {
  entries: RevocationListEntry[];
  /** Range-wide count regardless of pagination mode (offset or cursor). */
  total: number;
  nextCursor?: string | null;
  hasMore?: boolean;
}

/** Full model row shape the cursor helper returns before mapping. */
type RevocationListEntryShape = {
  jti: string;
  revokedAt: Date;
  reason: string;
};

@Injectable()
export class RevocationListService {
  private readonly logger = new Logger(RevocationListService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Get revocation list delta since a given timestamp.
   * The POS fetches this on every online check to stay current.
   */
  async getDeltaSince(since: Date): Promise<RevocationListEntry[]> {
    const entries = await this.prisma.offlineTokenRevocation.findMany({
      where: {
        revokedAt: { gt: since },
      },
      orderBy: { revokedAt: 'asc' },
    });

    return entries.map((e) => ({
      jti: e.jti,
      revokedAt: e.revokedAt,
      reason: e.reason,
    }));
  }

  /**
   * Get paginated revocation list. Cursor mode walks (revokedAt desc, id
   * desc): the table only grows, so deep pages must not re-scan.
   */
  async getList(params: {
    since?: Date;
    limit?: number;
    offset?: number;
    cursor?: string;
  }): Promise<RevocationListResult> {
    const where = params.since ? { revokedAt: { gt: params.since } } : {};

    // Both modes keep `total` in the response contract (existing consumers,
    // e.g. the blessing flow) and share the audit log below, so a full
    // migration to cursor pages does not open an observability hole.
    let rows: RevocationListEntryShape[];
    let total: number;
    let nextCursor: string | null = null;
    let hasMore = false;

    if (params.cursor) {
      const [page, count] = await Promise.all([
        paginateWithCursor<RevocationListEntryShape>({
          model: this.prisma.offlineTokenRevocation,
          baseWhere: where,
          limit: params.limit ?? 100,
          cursor: params.cursor,
          timeField: 'revokedAt',
          direction: 'desc',
          orderBy: [{ revokedAt: 'desc' }, { id: 'desc' }],
        }),
        this.prisma.offlineTokenRevocation.count({ where }),
      ]);
      rows = page.items;
      total = count;
      nextCursor = page.nextCursor;
      hasMore = page.hasMore;
    } else {
      const [findManyRows, count] = await Promise.all([
        this.prisma.offlineTokenRevocation.findMany({
          where,
          orderBy: [{ revokedAt: 'desc' }, { id: 'desc' }],
          take: params.limit ?? 100,
          skip: params.offset ?? 0,
        }),
        this.prisma.offlineTokenRevocation.count({ where }),
      ]);
      rows = findManyRows;
      total = count;
    }

    // Audit: log the revocation list fetch regardless of pagination mode.
    await this.auditService.log(AuditEvent.REVOCATION_LIST_UPDATED, {
      actorId: null,
      actorRole: null,
      details: {
        entriesReturned: rows.length,
        total,
        since: params.since?.toISOString(),
      },
    });

    return {
      entries: rows.map((e) => ({
        jti: e.jti,
        revokedAt: e.revokedAt,
        reason: e.reason,
      })),
      total,
      ...(params.cursor ? { nextCursor, hasMore } : {}),
    };
  }

  /**
   * Check if a specific JWT ID is revoked.
   */
  async isRevoked(jti: string): Promise<boolean> {
    const entry = await this.prisma.offlineTokenRevocation.findUnique({
      where: { jti },
    });
    return entry !== null;
  }

  /**
   * Get all revoked JTIs since a given timestamp (for push-based sync).
   * This is called by the sync module to include urgent revocations
   * in the next sync response to the POS.
   */
  async getUrgentRevocationsSince(since: Date): Promise<RevocationListEntry[]> {
    // Urgent = revoked within the last 24 hours or since the last check
    const cutoff =
      since > new Date(Date.now() - 86400000)
        ? since
        : new Date(Date.now() - 86400000);

    const entries = await this.prisma.offlineTokenRevocation.findMany({
      where: {
        revokedAt: { gt: cutoff },
      },
      orderBy: { revokedAt: 'desc' },
      take: 200, // Safety limit
    });

    return entries.map((e) => ({
      jti: e.jti,
      revokedAt: e.revokedAt,
      reason: e.reason,
    }));
  }

  /**
   * Clear old revocation entries (housekeeping).
   * Entries older than the configured retention period are deleted.
   */
  async cleanOldEntries(retentionDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 86400000);

    const result = await this.prisma.offlineTokenRevocation.deleteMany({
      where: {
        revokedAt: { lt: cutoff },
      },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned ${result.count} old revocation list entries`);
    }

    return result.count;
  }
}
