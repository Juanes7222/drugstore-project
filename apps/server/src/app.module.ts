import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { envSchema, EnvConfig } from './config/env.schema';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { BackofficeModule } from './modules/backoffice/backoffice.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => envSchema.parse(config),
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    BackofficeModule,
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
    PrismaModule,
  ],
})
export class AppModule {}
