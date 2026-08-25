/**
 * SaaS-admin module — protected cross-tenant surface for the platform
 * owner, strictly separated from the tenant backoffice. Access requires
 * the SAAS_ADMIN role plus the isPlatformAdmin flag; every per-customer
 * read takes an explicit subscription id and writes an audit-log row.
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { BackofficeModule } from '@/modules/backoffice/backoffice.module';
// LicensingModule exports SubscriptionsService/PlansService; the lifecycle
// actions delegate to them so transition rules stay single-sourced there.
import { LicensingModule } from '@/modules/licensing/licensing.module';
import { SaasAdminGuard } from './saas-admin.guard';
import { SaasAdminController } from './controllers/saas-admin.controller';
import { SaasAdminOverviewService } from './services/saas-admin-overview.service';
import { SaasAdminCustomerService } from './services/saas-admin-customer.service';
import { SaasAdminAccessAuditService } from './services/saas-admin-access-audit.service';
import { SaasAdminFraudService } from './services/saas-admin-fraud.service';
import { SaasAdminLifecycleService } from './services/saas-admin-lifecycle.service';
import { SaasAdminRevenueService } from './services/saas-admin-revenue.service';
import { SaasAdminAtRiskService } from './services/saas-admin-at-risk.service';
import { SaasAdminExportService } from './services/saas-admin-export.service';
import { SaasAdminPlatformAdminService } from './services/saas-admin-platform-admin.service';
import { SaasAdminSyncHealthService } from './services/saas-admin-sync-health.service';

@Module({
  imports: [PrismaModule, BackofficeModule, LicensingModule],
  controllers: [SaasAdminController],
  providers: [
    SaasAdminGuard,
    SaasAdminOverviewService,
    SaasAdminCustomerService,
    SaasAdminAccessAuditService,
    SaasAdminFraudService,
    SaasAdminLifecycleService,
    SaasAdminRevenueService,
    SaasAdminAtRiskService,
    SaasAdminExportService,
    SaasAdminPlatformAdminService,
    SaasAdminSyncHealthService,
  ],
  exports: [],
})
export class SaasAdminModule {}
