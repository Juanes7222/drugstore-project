/**
 * SaaS-admin controller — the platform operator's cross-tenant surface.
 * Every route requires the SAAS_ADMIN role AND the platform-admin flag
 * (SaasAdminGuard); every per-customer route takes an explicit
 * subscription id and is audit-logged by SaasAdminCustomerService.
 */

import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import type { User } from '@pharmacy/shared-types';
import type { Request } from 'express';
import { SaasAdminGuard } from '../saas-admin.guard';
import { SaasAdminOverviewService } from '../services/saas-admin-overview.service';
import { SaasAdminCustomerService } from '../services/saas-admin-customer.service';
import { SaasAdminFraudService } from '../services/saas-admin-fraud.service';
import { SaasAdminAccessAuditService } from '../services/saas-admin-access-audit.service';
import {
  AccessAuditQueryDto,
  AccessAuditQuerySchema,
  CustomerIdParamDto,
  CustomerIdParamSchema,
  CustomerSalesQueryDto,
  CustomerSalesQuerySchema,
  CustomersQueryDto,
  CustomersQuerySchema,
  FraudAlertIdParamDto,
  FraudAlertIdParamSchema,
  FraudAlertsQueryDto,
  FraudAlertsQuerySchema,
  ResolveFraudAlertBodyDto,
  ResolveFraudAlertBodySchema,
  TrialsEndingQueryDto,
  TrialsEndingQuerySchema,
} from '../dto/saas-admin-query.dto';

@Controller('saas-admin')
@UseGuards(JwtAuthGuard, SaasAdminGuard)
export class SaasAdminController {
  constructor(
    private readonly overview: SaasAdminOverviewService,
    private readonly customer: SaasAdminCustomerService,
    private readonly fraud: SaasAdminFraudService,
    private readonly accessAudit: SaasAdminAccessAuditService,
  ) {}

  /** GET /saas-admin/platform-overview — cross-tenant KPIs. */
  @Get('platform-overview')
  getPlatformOverview() {
    return this.overview.getPlatformOverview();
  }

  /** GET /saas-admin/customers — paginated subscription listing. */
  @Get('customers')
  getCustomers(@Query(new ZodValidationPipe(CustomersQuerySchema)) query: CustomersQueryDto) {
    return this.overview.getCustomers(query);
  }

  /** Declared before /customers/:id subroutes so literal segments win. */
  @Get('customers/:id')
  getCustomer(
    @Param(new ZodValidationPipe(CustomerIdParamSchema)) params: CustomerIdParamDto,
  ) {
    return this.overview.getCustomer(params.id);
  }

  @Get('customers/:id/dashboard')
  getCustomerDashboard(
    @CurrentUser() user: User,
    @Param(new ZodValidationPipe(CustomerIdParamSchema)) params: CustomerIdParamDto,
  ) {
    return this.customer.getDashboard(user, params.id);
  }

  @Get('customers/:id/sales')
  getCustomerSales(
    @CurrentUser() user: User,
    @Param(new ZodValidationPipe(CustomerIdParamSchema)) params: CustomerIdParamDto,
    @Query(new ZodValidationPipe(CustomerSalesQuerySchema)) query: CustomerSalesQueryDto,
  ) {
    return this.customer.getSales(user, params.id, query);
  }

  @Get('customers/:id/users')
  getCustomerUsers(
    @CurrentUser() user: User,
    @Param(new ZodValidationPipe(CustomerIdParamSchema)) params: CustomerIdParamDto,
  ) {
    return this.customer.listUsers(user, params.id);
  }

  @Get('customers/:id/sessions')
  getCustomerSessions(
    @CurrentUser() user: User,
    @Param(new ZodValidationPipe(CustomerIdParamSchema)) params: CustomerIdParamDto,
    @Query(new ZodValidationPipe(CustomersQuerySchema)) query: CustomersQueryDto,
  ) {
    return this.customer.getSessions(user, params.id, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get('customers/:id/workstations')
  getCustomerWorkstations(
    @CurrentUser() user: User,
    @Param(new ZodValidationPipe(CustomerIdParamSchema)) params: CustomerIdParamDto,
  ) {
    return this.customer.getWorkstations(user, params.id);
  }

  @Get('customers/:id/fiscal-status')
  getCustomerFiscalStatus(
    @CurrentUser() user: User,
    @Param(new ZodValidationPipe(CustomerIdParamSchema)) params: CustomerIdParamDto,
  ) {
    return this.customer.getFiscalStatus(user, params.id);
  }

  /** GET /saas-admin/fraud-alerts — paged cross-tenant fraud queue. */
  @Get('fraud-alerts')
  getFraudAlerts(
    @Query(new ZodValidationPipe(FraudAlertsQuerySchema)) query: FraudAlertsQueryDto,
  ) {
    return this.fraud.getFraudAlerts(query);
  }

  /** POST /saas-admin/fraud-alerts/:id/resolve — resolve as calling admin. */
  @Post('fraud-alerts/:id/resolve')
  resolveFraudAlert(
    @CurrentUser() user: User,
    @Param(new ZodValidationPipe(FraudAlertIdParamSchema)) params: FraudAlertIdParamDto,
    @Body(new ZodValidationPipe(ResolveFraudAlertBodySchema)) body: ResolveFraudAlertBodyDto,
    @Req() request: Request,
  ) {
    // Same extraction as AuditLogInterceptor: trust the proxy-adjusted req.ip
    // and store null (not a placeholder string) when it is unavailable.
    const ipAddress = request.ip || null;
    return this.fraud.resolveFraudAlert(user, params.id, body.note, ipAddress);
  }

  /** GET /saas-admin/access-audit — paged platform access trail. */
  @Get('access-audit')
  getAccessAudit(
    @Query(new ZodValidationPipe(AccessAuditQuerySchema)) query: AccessAuditQueryDto,
  ) {
    return this.accessAudit.listAccessEvents(query);
  }

  /** GET /saas-admin/trials-ending — TRIAL subscriptions ending within N days. */
  @Get('trials-ending')
  getTrialsEnding(
    @Query(new ZodValidationPipe(TrialsEndingQuerySchema)) query: TrialsEndingQueryDto,
  ) {
    return this.overview.getTrialsEnding(query.days);
  }
}
