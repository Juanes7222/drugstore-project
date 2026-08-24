/**
 * Backoffice audit log overview — read-only, paginated listing of the
 * immutable audit trail for the caller's tenant. Filtering and pagination
 * only; audit rows are never mutated through this module.
 */

import { Injectable } from '@nestjs/common';
import {
  AuditAction as PrismaAuditAction,
  Prisma,
  SystemModule as PrismaSystemModule,
} from '@pharmacy/database';
import { User } from '@pharmacy/shared-types';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BackofficeScopeService } from './backoffice-scope.service';

export interface AuditLogFilterQuery {
  from?: string;
  to?: string;
  action?: PrismaAuditAction;
  module?: PrismaSystemModule;
  userId?: string;
}

export interface AuditLogsOverviewQuery extends AuditLogFilterQuery {
  page?: number;
  pageSize?: number;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  module: string;
  entityId: string;
  /** Persisted `details` free-text; the interceptor writes none today, so null in practice. */
  summary: string | null;
  ipAddress: string | null;
  createdAt: string;
  user: { fullName: string; displayName: string | null };
}

export interface AuditLogsOverviewResult {
  data: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const AUDIT_LOG_LIST_SELECT = {
  id: true,
  action: true,
  module: true,
  entityId: true,
  details: true,
  ipAddress: true,
  createdAt: true,
  user: { select: { fullName: true, displayName: true } },
} satisfies Prisma.AuditLogSelect;

type AuditLogListPayload = Prisma.AuditLogGetPayload<{
  select: typeof AUDIT_LOG_LIST_SELECT;
}>;

@Injectable()
export class AuditLogOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BackofficeScopeService,
  ) {}

  async getAuditLogs(
    user: User,
    query: AuditLogsOverviewQuery,
  ): Promise<AuditLogsOverviewResult> {
    const where: Record<string, unknown> = {
      // AuditLog carries subscriptionId directly, so tenant scoping uses
      // tenantWhere (indexed) rather than the userId expansion sessions need.
      ...this.scope.tenantWhere(user),
      ...this.buildFilters(query),
    };

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: AUDIT_LOG_LIST_SELECT,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.toAuditLogEntry(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  private buildFilters(query: AuditLogFilterQuery): Record<string, unknown> {
    const filters: Record<string, unknown> = {};
    if (query.from || query.to) {
      filters.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.action) {
      filters.action = query.action;
    }
    if (query.module) {
      filters.module = query.module;
    }
    if (query.userId) {
      filters.userId = query.userId;
    }
    return filters;
  }

  /**
   * Rows written by global/system actors have no user relation (userId is
   * nullable); they fall back to empty display data instead of being dropped,
   * matching the sales listing's actor fallback.
   */
  private toAuditLogEntry(row: AuditLogListPayload): AuditLogEntry {
    return {
      id: row.id,
      action: row.action,
      module: row.module,
      entityId: row.entityId,
      summary: row.details,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt.toISOString(),
      user: {
        fullName: row.user?.fullName ?? '',
        displayName: row.user?.displayName ?? null,
      },
    };
  }
}
