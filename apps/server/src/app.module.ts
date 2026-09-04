import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { envSchemaWithStoragePolicy, EnvConfig } from './config/env.schema';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { AuthModule } from './modules/auth/auth.module';
import { BackofficeModule } from './modules/backoffice/backoffice.module';
import { SaasAdminModule } from './modules/saas-admin/saas-admin.module';
import { CashShiftModule } from './modules/cash-shift/cash-shift.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ClientsModule } from './modules/clients/clients.module';
import { InventoryLotsModule } from './modules/inventory-lots/inventory-lots.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { SalesPosModule } from './modules/sales-pos/sales-pos.module';
import { ConfigurationModule } from './modules/configuration/configuration.module';
import { FiscalDianModule } from './modules/fiscal-dian/fiscal-dian.module';
import { LicensingModule } from './modules/licensing/licensing.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SyncModule } from './modules/sync/sync.module';
import { UpdatesModule } from './modules/updates/updates.module';
import { TenantConfigModule } from './modules/tenant-config/tenant-config.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { PrintModule } from './modules/print/print.module';
import { DevModule } from './modules/dev/dev.module';
import { DataImportModule } from './modules/data-import/data-import.module';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';

/** Dev-only modules — only registered when NODE_ENV=development */
const DEV_MODULES = process.env.NODE_ENV === 'development' ? [DevModule] : [];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // In production, secrets can only come from Infisical (injected into
      // process.env by loadInfisicalSecretsIfNeeded in main.ts) — never from
      // a local .env file.
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      validate: (config) => envSchemaWithStoragePolicy.parse(config),
    }),
    ScheduleModule.forRoot(),
    // Rate limiting is intentionally SELECTIVE, not a global APP_GUARD: no
    // global guards exist in this app and a global ThrottlerGuard would run
    // before the per-controller JwtAuthGuard/RolesGuard, masking 401s as
    // 429s and breaking the POS offline fallback (which keys off 401).
    // The module registration below only provides the storage/options so the
    // endpoint-level @Throttle() decorators are enforceable where
    // ThrottlerGuard is bound explicitly (after the auth guards). The
    // fallback below therefore only applies to a guarded route without its
    // own @Throttle() override — currently none. 300 req/min/IP tolerates
    // multi-terminal stores behind one NAT IP against a steady state of
    // ~15 requests per 5-min sync cycle plus reconnect bursts.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60000, limit: 300 }],
    }),
    // Global modules must be imported before any module that consumes them:
    // Nest resolves module providers in import order, so AuthModule (and
    // every domain module) below can only see PrismaService and
    // TenantContextService once their @Global modules are registered.
    TenantModule,
    PrismaModule,
    StorageModule,
    AuthModule,
    BackofficeModule,
    SaasAdminModule,
    CashShiftModule,
    CatalogModule,
    ClientsModule,
    ConfigurationModule,
    FiscalDianModule,
    InventoryLotsModule,
    LicensingModule,
    PurchasesModule,
    ReportsModule,
    SalesPosModule,
    SyncModule,
    UpdatesModule,
    TenantConfigModule,
    PrintModule,
    DataImportModule,
    ...DEV_MODULES,
  ],
  // Registered as APP_INTERCEPTOR so it runs inside the request-scoped
  // tenant transaction (TenantContextInterceptor is bound in main.ts and
  // wraps it) — the audit row then commits atomically with the mutation.
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor }],
})
export class AppModule {}
