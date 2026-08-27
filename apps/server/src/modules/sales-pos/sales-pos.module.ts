import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { SalesController } from './controllers/sales.controller';
import { SalesService } from './services/sales.service';
import { SaleSequenceAuditService } from './services/sale-sequence-audit.service';
import { ClientReturnsController } from './controllers/client-returns.controller';
import { ClientReturnsService } from './services/client-returns.service';
import { ClientReturnCalculatorService } from './services/client-return-calculator.service';
import { CommissionCalculatorService } from './services/commission-calculator.service';
import { InventoryLotsModule } from '@/modules/inventory-lots/inventory-lots.module';
import { FiscalDianModule } from '@/modules/fiscal-dian/fiscal-dian.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { SyncAuthGuard } from '@/modules/sync/guards/sync-auth.guard';

/**
 * Sales-POS Module
 *
 * Deferred to a future phase:
 * - Prescription: Prescription-based sales workflows and validation
 */
@Module({
  imports: [PrismaModule, InventoryLotsModule, FiscalDianModule, AuthModule],
  controllers: [SalesController, ClientReturnsController],
  providers: [SalesService, SaleSequenceAuditService, ClientReturnsService, ClientReturnCalculatorService, CommissionCalculatorService, SyncAuthGuard],
  exports: [SalesService, SaleSequenceAuditService, ClientReturnsService],
})
export class SalesPosModule {}
