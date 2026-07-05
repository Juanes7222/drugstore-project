import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { SalesController } from './controllers/sales.controller';
import { SalesService } from './services/sales.service';
import { ClientReturnsController } from './controllers/client-returns.controller';
import { ClientReturnsService } from './services/client-returns.service';
import { ClientReturnCalculatorService } from './services/client-return-calculator.service';
import { InventoryLotsModule } from '@/modules/inventory-lots/inventory-lots.module';

/**
 * Sales-POS Module
 *
 * Deferred to a future phase:
 * - Prescription: Prescription-based sales workflows and validation
 */
@Module({
  imports: [PrismaModule, InventoryLotsModule],
  controllers: [SalesController, ClientReturnsController],
  providers: [SalesService, ClientReturnsService, ClientReturnCalculatorService],
  exports: [SalesService, ClientReturnsService],
})
export class SalesPosModule {}
