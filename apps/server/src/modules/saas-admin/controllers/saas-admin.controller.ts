/**
 * SaaS-admin controller — the platform operator's cross-tenant surface.
 * Every route requires the SAAS_ADMIN role AND the platform-admin flag
 * (SaasAdminGuard); every per-customer route takes an explicit
 * subscription id and is audit-logged by SaasAdminCustomerService.
 */

import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import type { User } from '@pharmacy/shared-types';
import { SaasAdminGuard } from '../saas-admin.guard';
import { SaasAdminOverviewService } from '../services/saas-admin-overview.service';
import { SaasAdminCustomerService } from '../services/saas-admin-customer.service';
import {
  CustomerIdParamDto,
  CustomerIdParamSchema,
  CustomerSalesQueryDto,
  CustomerSalesQuerySchema,
  CustomersQueryDto,
  CustomersQuerySchema,
} from '../dto/saas-admin-query.dto';

@Controller('saas-admin')
@UseGuards(JwtAuthGuard, SaasAdminGuard)
export class SaasAdminController {
  constructor(
    private readonly overview: SaasAdminOverviewService,
    private readonly customer: SaasAdminCustomerService,
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
}
