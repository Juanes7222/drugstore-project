/**
 * SaaS-admin fraud queue — cross-tenant listing of licensing FraudAlert
 * rows and their resolution by a platform admin. Resolution is tracked by
 * the resolvedAt/resolvedById/resolutionNotes columns (the
 * FraudAlertStatus enum carries no RESOLVED value), so "unresolved" means
 * resolvedAt IS NULL.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma } from '@pharmacy/database';
import { SaasAdminAccessAuditService } from './saas-admin-access-audit.service';
import { FraudAlertAlreadyResolvedException } from '../exceptions/fraud-alert-already-resolved.exception';
import { FraudAlertNotFoundException } from '../exceptions/fraud-alert-not-found.exception';

export interface FraudAlertsQuery {
  page?: number;
  pageSize?: number;
  /** FraudAlertStatus value, or ALL. Omitted defaults to unresolved only. */
  status?: 'OPEN' | 'INVESTIGATING' | 'DISMISSED' | 'CONFIRMED_FRAUD' | 'ALL';
}

/** One row of GET /saas-admin/fraud-alerts. */
export interface SaasAdminFraudAlertRow {
  id: string;
  subscriptionId: string;
  customerName: string;
  /** Detector that raised the alert, e.g. HardwareFingerprintCollisionDetector. */
  type: string;
  severity: string;
  suggestedAction: string;
  description: string;
  status: string;
  createdAt: string;
  detectedAt: string;
  resolvedAt: string | null;
  resolvedByAdminEmail: string | null;
}

export interface SaasAdminFraudAlertsResult {
  data: SaasAdminFraudAlertRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const FRAUD_ALERT_ROW_INCLUDE = {
  subscription: { select: { customerName: true } },
} satisfies Prisma.FraudAlertInclude;

type FraudAlertWithSubscription = Prisma.FraudAlertGetPayload<{
  include: typeof FRAUD_ALERT_ROW_INCLUDE;
}>;

@Injectable()
export class SaasAdminFraudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessAudit: SaasAdminAccessAuditService,
  ) {}

  /**
   * Paged fraud alerts, newest first (ordered by detectedAt, which the
   * schema indexes). Filter semantics — omitted `status` returns ONLY
   * unresolved alerts (the operator's working queue); an explicit status
   * filters exactly on it with no resolution constraint; ALL disables
   * filtering entirely.
   */
  async getFraudAlerts(
    query: FraudAlertsQuery,
  ): Promise<SaasAdminFraudAlertsResult> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 20));
    const where = this.buildListFilter(query.status);

    const [alerts, total] = await Promise.all([
      this.prisma.fraudAlert.findMany({
        where,
        orderBy: { detectedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: FRAUD_ALERT_ROW_INCLUDE,
      }),
      this.prisma.fraudAlert.count({ where }),
    ]);

    return {
      data: await this.toRows(alerts),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Resolve an alert as the calling admin. The conditional updateMany
   * (resolvedAt: null in the WHERE) makes concurrent double-resolution
   * impossible without a transaction: exactly one caller flips the row.
   * Returns the updated row; writes an ACCESS audit entry through the
   * same mechanism as the per-customer reads.
   */
  async resolveFraudAlert(
    actor: { id: string; role: string },
    fraudAlertId: string,
    note?: string,
    ipAddress?: string | null,
  ): Promise<SaasAdminFraudAlertRow> {
    const resolved = await this.prisma.fraudAlert.updateMany({
      where: { id: fraudAlertId, resolvedAt: null },
      data: {
        resolvedAt: new Date(),
        resolvedById: actor.id,
        resolutionNotes: note ?? null,
      },
    });

    if (resolved.count === 0) {
      const existing = await this.prisma.fraudAlert.findUnique({
        where: { id: fraudAlertId },
        select: { id: true },
      });
      if (!existing) {
        throw new FraudAlertNotFoundException(fraudAlertId);
      }
      throw new FraudAlertAlreadyResolvedException(fraudAlertId);
    }

    const updated = await this.prisma.fraudAlert.findUnique({
      where: { id: fraudAlertId },
      include: FRAUD_ALERT_ROW_INCLUDE,
    });
    if (!updated) {
      // The row was just flipped above; unreachable short of concurrent hard deletion.
      throw new FraudAlertNotFoundException(fraudAlertId);
    }

    await this.accessAudit.recordCustomerAccess({
      actorUser: actor,
      subscriptionId: updated.subscriptionId,
      endpoint: `/saas-admin/fraud-alerts/${fraudAlertId}/resolve`,
      ipAddress: ipAddress ?? null,
    });

    return (await this.toRows([updated]))[0];
  }

  private buildListFilter(
    status: FraudAlertsQuery['status'],
  ): Prisma.FraudAlertWhereInput {
    if (status === undefined || status === null) {
      // Default queue: unresolved only, regardless of workflow status.
      return { resolvedAt: null };
    }
    if (status === 'ALL') {
      return {};
    }
    // The DTO's literals are exactly the persisted FraudAlertStatus values.
    return { status };
  }

  /**
   * Map persisted alerts to API rows, resolving admin emails separately:
   * FraudAlert.resolvedById carries no Prisma relation to User, so emails
   * are batch-fetched for the page's distinct resolvers only.
   */
  private async toRows(
    alerts: FraudAlertWithSubscription[],
  ): Promise<SaasAdminFraudAlertRow[]> {
    const resolverIds = [
      ...new Set(
        alerts
          .map((alert) => alert.resolvedById)
          .filter((id): id is string => id !== null),
      ),
    ];
    const resolvers =
      resolverIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: resolverIds } },
            select: { id: true, email: true },
          })
        : [];
    const emailByResolverId = new Map(
      resolvers.map((resolver) => [resolver.id, resolver.email]),
    );

    return alerts.map((alert) => ({
      id: alert.id,
      subscriptionId: alert.subscriptionId,
      customerName: alert.subscription.customerName,
      type: alert.detectorName,
      severity: alert.severity,
      suggestedAction: alert.suggestedAction,
      description: alert.reason,
      status: alert.status,
      createdAt: alert.createdAt.toISOString(),
      detectedAt: alert.detectedAt.toISOString(),
      resolvedAt: alert.resolvedAt?.toISOString() ?? null,
      resolvedByAdminEmail:
        (alert.resolvedById && emailByResolverId.get(alert.resolvedById)) ??
        null,
    }));
  }
}
