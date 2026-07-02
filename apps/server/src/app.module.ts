import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema, EnvConfig } from './config/env.schema';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { CashShiftModule } from './modules/cash-shift/cash-shift.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ClientsModule } from './modules/clients/clients.module';
import { InventoryLotsModule } from './modules/inventory-lots/inventory-lots.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { SalesPosModule } from './modules/sales-pos/sales-pos.module';
import { ConfigurationModule } from './modules/configuration/configuration.module';
import { FiscalDianModule } from './modules/fiscal-dian/fiscal-dian.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SyncModule } from './modules/sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => envSchema.parse(config),
    }),
    AuthModule,
    CashShiftModule,
    CatalogModule,
    ClientsModule,
    ConfigurationModule,
    FiscalDianModule,
    InventoryLotsModule,
    PurchasesModule,
    ReportsModule,
    SalesPosModule,
    SyncModule,
    PrismaModule,
  ],
})
export class AppModule {}
