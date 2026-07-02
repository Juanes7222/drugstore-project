import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { SuppliersController } from './controllers/suppliers.controller';
import { PurchaseOrdersController } from './controllers/purchase-orders.controller';
import { SuppliersService } from './services/suppliers.service';
import { PurchaseOrdersService } from './services/purchase-orders.service';

/**
 * Purchases Module
 *
 * Deferred to logic phase (not scaffolded in this phase):
 * - PurchaseReception: Receiving goods against purchase orders
 * - SupplierReturn: Returning goods to suppliers
 */
@Module({
  imports: [PrismaModule],
  controllers: [SuppliersController, PurchaseOrdersController],
  providers: [SuppliersService, PurchaseOrdersService],
  exports: [SuppliersService, PurchaseOrdersService],
})
export class PurchasesModule {}
