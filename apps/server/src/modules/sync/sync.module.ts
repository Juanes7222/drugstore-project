import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { CashShiftModule } from '@/modules/cash-shift/cash-shift.module';
import { ClientsModule } from '@/modules/clients/clients.module';
import { SalesPosModule } from '@/modules/sales-pos/sales-pos.module';
import { InventoryLotsModule } from '@/modules/inventory-lots/inventory-lots.module';
import { FiscalDianModule } from '@/modules/fiscal-dian/fiscal-dian.module';
import { CatalogModule } from '@/modules/catalog/catalog.module';
import { PurchasesModule } from '@/modules/purchases/purchases.module';
import { SyncController } from './controllers/sync.controller';
import { TerminalsController } from './controllers/terminals.controller';
import { SyncEventController } from './controllers/sync-event.controller';
import { HeartbeatController } from './controllers/heartbeat.controller';
import { SyncService } from './services/sync.service';
import { SyncHealthService } from './services/sync-health.service';
import { SyncEventService } from './services/sync-event.service';
import { WorkstationHeartbeatService } from './services/workstation-heartbeat.service';
import { TerminalBackupService } from './services/terminal-backup.service';
import { InvoiceTransmissionResultService } from './services/invoice-transmission-result.service';
import { SyncOperationDispatcherService } from './sync-operation-dispatcher.service';
import { SyncProcessingJob } from './jobs/sync-processing.job';
import { SyncAuthGuard } from './guards/sync-auth.guard';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    CashShiftModule,
    ClientsModule,
    SalesPosModule,
    InventoryLotsModule,
    FiscalDianModule,
    CatalogModule,
    PurchasesModule,
  ],
  controllers: [SyncController, TerminalsController, SyncEventController, HeartbeatController],
  providers: [
    SyncService,
    SyncHealthService,
    SyncEventService,
    WorkstationHeartbeatService,
    SyncOperationDispatcherService,
    SyncProcessingJob,
    TerminalBackupService,
    InvoiceTransmissionResultService,
    SyncAuthGuard,
  ],
  exports: [
    SyncService,
    SyncHealthService,
    SyncEventService,
    WorkstationHeartbeatService,
    TerminalBackupService,
    InvoiceTransmissionResultService,
  ],
})
export class SyncModule {}
