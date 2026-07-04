import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { LotsController } from './controllers/lots.controller';
import { InventoryAdjustmentsController } from './controllers/inventory-adjustments.controller';
import { InventoryMovementsController } from './controllers/inventory-movements.controller';
import { PhysicalCountsController } from './controllers/physical-counts.controller';
import { LotsService } from './services/lots.service';
import { InventoryAdjustmentsService } from './services/inventory-adjustments.service';
import { InventoryMovementsService } from './services/inventory-movements.service';
import { PhysicalCountsService } from './services/physical-counts.service';

/**
 * Inventory-Lots Module
 *
 * Deferred to a future phase:
 * - AutoExpirationJob: Automatic lot expiration scheduling and execution
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    LotsController,
    InventoryAdjustmentsController,
    InventoryMovementsController,
    PhysicalCountsController,
  ],
  providers: [
    LotsService,
    InventoryAdjustmentsService,
    InventoryMovementsService,
    PhysicalCountsService,
  ],
  exports: [
    LotsService,
    InventoryAdjustmentsService,
    InventoryMovementsService,
    PhysicalCountsService,
  ],
})
export class InventoryLotsModule {}
