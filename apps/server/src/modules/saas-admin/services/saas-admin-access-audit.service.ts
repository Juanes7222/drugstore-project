/**
 * SaaS-admin access audit — records every cross-tenant read a platform
 * admin performs against a specific customer subscription. GET endpoints
 * are not covered by the mutating-only AuditLogInterceptor, so this
 * service writes rows directly, mirroring auth's AuditService contract:
 * fire-and-forget, never blocking or failing the request.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import * as crypto from 'node:crypto';

// The persisted SystemModule enum has no dedicated platform-admin slug;
// REPORTS is the established bucket for read-only reporting surfaces.
// The Subscription entityType/entityId carry the precise target.
const ACCESS_MODULE = 'REPORTS' as const;
const ACCESS_ACTION = 'ACCESS' as const;
const ENTITY_TYPE = 'Subscription';
// Bulk CSV exports touch every tenant at once, so they have no single
// subscription target; they are audited once per export under their own
// entity type and kept visible in the same access trail.
const EXPORT_ENTITY_TYPE = 'CsvExport';

export interface AccessAuditQuery {
  page?: number;
  pageSize?: number;
}

/** One row of GET /saas-admin/access-audit. */
export interface SaasAdminAccessAuditRow {
  id: string;
  actorEmail: string | null;
  action: string;
  subscriptionId: string | null;
  customerName: string | null;
  /** Stored details payload (the accessed endpoint descriptor), if any. */
  summary: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface SaasAdminAccessAuditResult {
  data: SaasAdminAccessAuditRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

@Injectable()
export class SaasAdminAccessAuditService {
  private readonly logger = new Logger(SaasAdminAccessAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a platform admin's access to one customer's data. Best-effort.
   */
  async recordCustomerAccess(params: {
    actorUser: { id: string; role: string };
    subscriptionId: string;
    endpoint: string;
    ipAddress?: string | null;
    /** Extra payload merged into the stored details JSON (e.g. suspension reason). */
    details?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          action: ACCESS_ACTION,
          module: ACCESS_MODULE,
          entityType: ENTITY_TYPE,
          entityId: params.subscriptionId,
          userId: params.actorUser.id,
          userRole: params.actorUser.role,
          subscriptionId: params.subscriptionId,
          ipAddress: params.ipAddress ?? null,
          details: JSON.stringify({ endpoint: params.endpoint, ...params.details }),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to audit saas-admin access to subscription ${params.subscriptionId}`,
        error,
      );
    }
  }

  /**
   * Record a platform admin's bulk CSV export (cross-tenant read with no
   * single subscription target). One row per export, best-effort.
   */
  async recordExportAccess(params: {
    actorUser: { id: string; role: string };
    endpoint: string;
    fileName: string;
    rowCount: number;
    ipAddress?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          action: ACCESS_ACTION,
          module: ACCESS_MODULE,
          entityType: EXPORT_ENTITY_TYPE,
          entityId: params.fileName,
          userId: params.actorUser.id,
          userRole: params.actorUser.role,
          subscriptionId: null,
          ipAddress: params.ipAddress ?? null,
          details: JSON.stringify({
            endpoint: params.endpoint,
            rowCount: params.rowCount,
          }),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to audit saas-admin export ${params.fileName}`,
        error,
      );
    }
  }

  /**
   * Paged platform access-audit trail, newest first. Reads the shared
   * AuditLog table filtered to this service's own write conventions
   * (ACCESS / REPORTS / Subscription or CsvExport) — no dedicated table.
   * Customer names are resolved in one batched lookup for the page's
   * distinct subscription ids.
   */
  async listAccessEvents(
    query: AccessAuditQuery,
  ): Promise<SaasAdminAccessAuditResult> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 20));
    const where = {
      action: ACCESS_ACTION,
      module: ACCESS_MODULE,
      entityType: { in: [ENTITY_TYPE, EXPORT_ENTITY_TYPE] },
    };

    const [events, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const customerNames = await this.loadCustomerNames(
      events
        .map((event) => event.subscriptionId)
        .filter((id): id is string => id !== null),
    );

    return {
      data: events.map((event) => ({
        id: event.id,
        actorEmail: event.user?.email ?? null,
        action: event.action,
        subscriptionId: event.subscriptionId,
        customerName:
          (event.subscriptionId &&
            customerNames.get(event.subscriptionId)) ??
          null,
        summary: event.details,
        ipAddress: event.ipAddress,
        createdAt: event.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /** Batched customerName resolution for a page of audit rows. */
  private async loadCustomerNames(
    subscriptionIds: string[],
  ): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(subscriptionIds)];
    if (uniqueIds.length === 0) {
      return new Map();
    }
    const subscriptions = await this.prisma.subscription.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, customerName: true },
    });
    return new Map(
      subscriptions.map((subscription) => [
        subscription.id,
        subscription.customerName,
      ]),
    );
  }
}
