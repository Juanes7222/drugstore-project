import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { CashShiftModule } from '@/modules/cash-shift/cash-shift.module';
import { ClientsModule } from '@/modules/clients/clients.module';
import { SalesPosModule } from '@/modules/sales-pos/sales-pos.module';
import { InventoryLotsModule } from '@/modules/inventory-lots/inventory-lots.module';
import { FiscalDianModule } from '@/modules/fiscal-dian/fiscal-dian.module';
import { CatalogModule } from '@/modules/catalog/catalog.module';
import { PurchasesModule } from '@/modules/purchases/purchases.module';
import { SyncController } from './controllers/sync.controller';
import { TerminalsController } from './controllers/terminals.controller';
import { SyncService } from './services/sync.service';
import { SyncHealthService } from './services/sync-health.service';
import { TerminalBackupService } from './services/terminal-backup.service';
import { InvoiceTransmissionResultService } from './services/invoice-transmission-result.service';
import { SyncOperationDispatcherService } from './sync-operation-dispatcher.service';
import { SyncProcessingJob } from './jobs/sync-processing.job';

@Module({
  imports: [
    PrismaModule,
    CashShiftModule,
    ClientsModule,
    SalesPosModule,
    InventoryLotsModule,
    FiscalDianModule,
    CatalogModule,
    PurchasesModule,
  ],
  controllers: [SyncController, TerminalsController],
  providers: [
    SyncService,
    SyncHealthService,
    SyncOperationDispatcherService,
    SyncProcessingJob,
    TerminalBackupService,
    InvoiceTransmissionResultService,
  ],
  exports: [SyncService, SyncHealthService, TerminalBackupService, InvoiceTransmissionResultService],
})
export class SyncModule {}
