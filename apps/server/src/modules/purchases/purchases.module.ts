import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { SuppliersController } from './controllers/suppliers.controller';
import { SuppliersService } from './services/suppliers.service';
import { PurchaseOrdersController } from './controllers/purchase-orders.controller';
import { PurchaseOrdersService } from './services/purchase-orders.service';
import { PurchaseReceptionsController } from './controllers/purchase-receptions.controller';
import { PurchaseReceptionsService } from './services/purchase-receptions.service';
import { InventoryLotsModule } from '@/modules/inventory-lots/inventory-lots.module';

@Module({
  imports: [PrismaModule, InventoryLotsModule],
  controllers: [SuppliersController, PurchaseOrdersController, PurchaseReceptionsController],
  providers: [SuppliersService, PurchaseOrdersService, PurchaseReceptionsService],
  exports: [SuppliersService, PurchaseOrdersService, PurchaseReceptionsService],
})
export class PurchasesModule {}
