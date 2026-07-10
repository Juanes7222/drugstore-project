import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from '../services/reports.service';
import { ReportDateRangeQueryDto } from '../dto/report-date-range.query.dto';
import { SalesSummaryResponseDto } from '../dto/sales-summary.response.dto';
import { CashShiftSummaryResponseDto } from '../dto/cash-shift-summary.response.dto';
import { InventoryValuationResponseDto } from '../dto/inventory-valuation.response.dto';
import { TaxSummaryResponseDto } from '../dto/tax-summary.response.dto';
import { FiscalReportResponseDto } from '../dto/fiscal-report.response.dto';
import { DailyReportResponseDto } from '../dto/daily-report.response.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { AuditAction, SystemModule, RoleType } from '@pharmacy/shared-types';

/**
 * Reports controller.
 *
 * All report endpoints accept an optional `view` query parameter
 * (`'fiscal' | 'operational'`) for API forward compatibility with POS
 * terminals that resolve local invoice adjustments. On the server both
 * views produce identical data because the `InvoiceLocalAdjustment`
 * table is local-only to each terminal.
 */
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleType.ACCOUNTANT, RoleType.ADMIN)
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get('sales-summary')
  @Auditable({
    action: AuditAction.ACCESS,
    module: SystemModule.REPORTS,
    entityType: 'SalesSummary',
  })
  async getSalesSummary(
    @Query() query: ReportDateRangeQueryDto,
  ): Promise<SalesSummaryResponseDto> {
    return this.reportsService.getSalesSummary(query);
  }

  @Get('cash-shift-summary')
  @Auditable({
    action: AuditAction.ACCESS,
    module: SystemModule.REPORTS,
    entityType: 'CashShiftSummary',
  })
  async getCashShiftSummary(
    @Query() query: ReportDateRangeQueryDto,
  ): Promise<CashShiftSummaryResponseDto> {
    return this.reportsService.getCashShiftSummary(query);
  }

  @Get('inventory-valuation')
  @Auditable({
    action: AuditAction.ACCESS,
    module: SystemModule.REPORTS,
    entityType: 'InventoryValuation',
  })
  async getInventoryValuation(
    @Query() query: ReportDateRangeQueryDto,
  ): Promise<InventoryValuationResponseDto> {
    return this.reportsService.getInventoryValuation(query);
  }

  @Get('tax-summary')
  @Auditable({
    action: AuditAction.ACCESS,
    module: SystemModule.REPORTS,
    entityType: 'TaxSummary',
  })
  async getTaxSummary(
    @Query() query: ReportDateRangeQueryDto,
  ): Promise<TaxSummaryResponseDto> {
    return this.reportsService.getTaxSummary(query);
  }

  @Get('fiscal')
  @Auditable({
    action: AuditAction.ACCESS,
    module: SystemModule.REPORTS,
    entityType: 'FiscalReport',
  })
  async getFiscalReport(
    @Query() query: ReportDateRangeQueryDto,
  ): Promise<FiscalReportResponseDto> {
    return this.reportsService.getFiscalReport(query);
  }

  @Get('daily')
  @Auditable({
    action: AuditAction.ACCESS,
    module: SystemModule.REPORTS,
    entityType: 'DailyReport',
  })
  async getDailyReport(
    @Query() query: ReportDateRangeQueryDto,
  ): Promise<DailyReportResponseDto> {
    return this.reportsService.getDailyReport(query);
  }
}
