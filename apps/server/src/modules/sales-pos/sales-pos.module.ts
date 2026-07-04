import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { SalesController } from './controllers/sales.controller';
import { SalesService } from './services/sales.service';
import { InventoryLotsModule } from '@/modules/inventory-lots/inventory-lots.module';

/**
 * Sales-POS Module
 *
 * Deferred to logic phase (not scaffolded in this phase):
 * - Prescription: Prescription-based sales workflows and validation
 * - ClientReturn: Client returns and credit note generation
 */
@Module({
  imports: [PrismaModule, InventoryLotsModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesPosModule {}
