/**
 * SaaS-admin CSV exports — full (unpaginated) platform-wide extracts of the
 * customers list and the at-risk report. Serialization reuses backoffice's
 * CsvBuilderService so escaping, BOM handling, and timestamp formatting stay
 * single-sourced; this service only maps rows to cells and audits the export.
 */

import { Injectable } from '@nestjs/common';
import { CsvBuilderService } from '@/modules/backoffice/services/csv-builder.service';
import {
  SaasAdminCustomerRow,
  SaasAdminOverviewService,
} from './saas-admin-overview.service';
import { SaasAdminAtRiskService } from './saas-admin-at-risk.service';
import { SaasAdminAccessAuditService } from './saas-admin-access-audit.service';
import type { User } from '@pharmacy/shared-types';

const CUSTOMERS_CSV_HEADERS = [
  'customerName',
  'customerTaxId',
  'customerEmail',
  'status',
  'planCode',
  'planName',
  'currentPeriodStart',
  'currentPeriodEnd',
  'trialEndsAt',
  'cancelAtPeriodEnd',
  'locations',
  'workstationActivations',
  'fraudAlerts',
  'lastActivityAt',
] as const;

const AT_RISK_CSV_HEADERS = [
  'customerName',
  'customerEmail',
  'status',
  'lastSaleAt',
  'inactiveDays',
  'workstationActivations',
] as const;

@Injectable()
export class SaasAdminExportService {
  constructor(
    private readonly overview: SaasAdminOverviewService,
    private readonly atRisk: SaasAdminAtRiskService,
    private readonly accessAudit: SaasAdminAccessAuditService,
    private readonly csvBuilder: CsvBuilderService,
  ) {}

  /**
   * CSV of every subscription matching the customers-list filter, same rows
   * and ordering as GET /saas-admin/customers without pagination.
   * Returns the full payload (BOM included); the controller sets headers.
   */
  async getCustomersCsv(
    actor: User,
    query?: string,
    ipAddress?: string | null,
  ): Promise<string> {
    const rows = await this.overview.getCustomerRowsForExport(query);
    const csv = this.csvBuilder.buildCsv(
      CUSTOMERS_CSV_HEADERS,
      rows.map((row) => this.toCustomerCsvRow(row)),
    );
    await this.accessAudit.recordExportAccess({
      actorUser: { id: actor.id, role: actor.role },
      endpoint: '/saas-admin/customers/export',
      fileName: this.exportFileName('saas-customers'),
      rowCount: rows.length,
      ipAddress,
    });
    return csv;
  }

  /**
   * CSV of the at-risk report (same computation and 100-row cap as the JSON
   * endpoint); never-sold rows keep an empty lastSaleAt cell.
   */
  async getAtRiskCsv(
    actor: User,
    inactiveDays: number,
    ipAddress?: string | null,
  ): Promise<string> {
    const rows = await this.atRisk.getAtRiskCustomers(inactiveDays);
    const csv = this.csvBuilder.buildCsv(
      AT_RISK_CSV_HEADERS,
      rows.map((row) => [
        row.customerName,
        row.customerEmail ?? '',
        row.status,
        row.lastSaleAt
          ? this.csvBuilder.formatDateTime(new Date(row.lastSaleAt))
          : '',
        String(inactiveDays),
        String(row.workstationActivations),
      ]),
    );
    await this.accessAudit.recordExportAccess({
      actorUser: { id: actor.id, role: actor.role },
      endpoint: '/saas-admin/at-risk/export',
      fileName: this.exportFileName('saas-at-risk'),
      rowCount: rows.length,
      ipAddress,
    });
    return csv;
  }

  private toCustomerCsvRow(row: SaasAdminCustomerRow): string[] {
    return [
      row.customerName,
      row.customerTaxId,
      row.customerEmail ?? '',
      row.status,
      row.plan.code,
      row.plan.name,
      this.csvBuilder.formatDateTime(new Date(row.currentPeriodStart)),
      this.csvBuilder.formatDateTime(new Date(row.currentPeriodEnd)),
      row.trialEndsAt
        ? this.csvBuilder.formatDateTime(new Date(row.trialEndsAt))
        : '',
      String(row.cancelAtPeriodEnd),
      String(row._count.locations),
      String(row._count.workstationActivations),
      String(row._count.fraudAlerts),
      row.lastActivityAt
        ? this.csvBuilder.formatDateTime(new Date(row.lastActivityAt))
        : '',
    ];
  }

  /**
   * Task-mandated date-only stamp `saas-<scope>-YYYYMMDD.csv`; the shared
   * builder's stamp is YYYYMMDD-HHmm, so take its date part unchanged.
   */
  private exportFileName(scope: string, now: Date = new Date()): string {
    return `${scope}-${this.csvBuilder.exportFileStamp(now).slice(0, 8)}.csv`;
  }
}
