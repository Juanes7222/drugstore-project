/**
 * SaaS-admin module — protected cross-tenant surface for the platform
 * owner, strictly separated from the tenant backoffice. Access requires
 * the SAAS_ADMIN role plus the isPlatformAdmin flag; every per-customer
 * read takes an explicit subscription id and writes an audit-log row.
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { BackofficeModule } from '@/modules/backoffice/backoffice.module';
import { SaasAdminGuard } from './saas-admin.guard';
import { SaasAdminController } from './controllers/saas-admin.controller';
import { SaasAdminOverviewService } from './services/saas-admin-overview.service';
import { SaasAdminCustomerService } from './services/saas-admin-customer.service';
import { SaasAdminAccessAuditService } from './services/saas-admin-access-audit.service';

@Module({
  imports: [PrismaModule, BackofficeModule],
  controllers: [SaasAdminController],
  providers: [
    SaasAdminGuard,
    SaasAdminOverviewService,
    SaasAdminCustomerService,
    SaasAdminAccessAuditService,
  ],
  exports: [],
})
export class SaasAdminModule {}
