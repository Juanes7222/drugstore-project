import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { LotsController } from './controllers/lots.controller';
import { InventoryAdjustmentsController } from './controllers/inventory-adjustments.controller';
import { InventoryMovementsController } from './controllers/inventory-movements.controller';
import { LotsService } from './services/lots.service';
import { InventoryAdjustmentsService } from './services/inventory-adjustments.service';
import { InventoryMovementsService } from './services/inventory-movements.service';

/**
 * Inventory-Lots Module
 *
 * Deferred to logic phase (not scaffolded in this phase):
 * - PhysicalCount: Physical inventory counting workflows
 * - AutoExpirationJob: Automatic lot expiration scheduling and execution
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    LotsController,
    InventoryAdjustmentsController,
    InventoryMovementsController,
  ],
  providers: [LotsService, InventoryAdjustmentsService, InventoryMovementsService],
  exports: [LotsService, InventoryAdjustmentsService, InventoryMovementsService],
})
export class InventoryLotsModule {}
