import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { SyncModule } from '@/modules/sync/sync.module';
import { SyncHealthController } from './controllers/sync-health.controller';
import { DashboardController } from './controllers/dashboard.controller';
import { SalesController } from './controllers/sales.controller';
import { CashShiftsController } from './controllers/cash-shifts.controller';
import { InventoryAlertsController } from './controllers/inventory-alerts.controller';
import { FiscalStatusController } from './controllers/fiscal-status.controller';
import { SessionsController } from './controllers/sessions.controller';
import { WorkstationsController } from './controllers/workstations.controller';
import { SubscriptionsController } from './controllers/subscriptions.controller';
import { AuditLogsController } from './controllers/audit-logs.controller';
import { BackofficeScopeService } from './services/backoffice-scope.service';
import { BackofficeActorLookupService } from './services/backoffice-actor-lookup.service';
import { CsvBuilderService } from './services/csv-builder.service';
import { DashboardService } from './services/dashboard.service';
import { SalesOverviewService } from './services/sales-overview.service';
import { CashShiftOverviewService } from './services/cash-shift-overview.service';
import { InventoryAlertsService } from './services/inventory-alerts.service';
import { FiscalStatusService } from './services/fiscal-status.service';
import { SessionOverviewService } from './services/session-overview.service';
import { WorkstationOverviewService } from './services/workstation-overview.service';
import { SubscriptionOverviewService } from './services/subscription-overview.service';
import { AuditLogOverviewService } from './services/audit-log-overview.service';

/**
 * Backoffice module — read-only administrative surfaces.
 *
 * Provides endpoints for admin dashboards: global KPIs, sales, cash-shift
 * and fiscal overviews, inventory alerts, active sessions, workstation
 * state, the audit trail listing, and the SAAS_ADMIN subscription listing.
 * All mutating operations are owned by their respective domain modules.
 */
@Module({
  imports: [PrismaModule, SyncModule],
  controllers: [
    SyncHealthController,
    DashboardController,
    SalesController,
    CashShiftsController,
    InventoryAlertsController,
    FiscalStatusController,
    SessionsController,
    WorkstationsController,
    SubscriptionsController,
    AuditLogsController,
  ],
  providers: [
    BackofficeScopeService,
    BackofficeActorLookupService,
    CsvBuilderService,
    DashboardService,
    SalesOverviewService,
    CashShiftOverviewService,
    InventoryAlertsService,
    FiscalStatusService,
    SessionOverviewService,
    WorkstationOverviewService,
    SubscriptionOverviewService,
    AuditLogOverviewService,
  ],
})
export class BackofficeModule {}
