import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { SuppliersController } from './controllers/suppliers.controller';
import { SuppliersService } from './services/suppliers.service';
import { PurchaseOrdersController } from './controllers/purchase-orders.controller';
import { PurchaseOrdersService } from './services/purchase-orders.service';
import { PurchaseReceptionsController } from './controllers/purchase-receptions.controller';
import { PurchaseReceptionsService } from './services/purchase-receptions.service';
import { SupplierReturnsController } from './controllers/supplier-returns.controller';
import { SupplierReturnsService } from './services/supplier-returns.service';
import { InventoryLotsModule } from '@/modules/inventory-lots/inventory-lots.module';
import { FiscalDianModule } from '@/modules/fiscal-dian/fiscal-dian.module';

@Module({
  imports: [PrismaModule, InventoryLotsModule, FiscalDianModule],
  controllers: [
    SuppliersController,
    PurchaseOrdersController,
    PurchaseReceptionsController,
    SupplierReturnsController,
  ],
  providers: [
    SuppliersService,
    PurchaseOrdersService,
    PurchaseReceptionsService,
    SupplierReturnsService,
  ],
  exports: [
    SuppliersService,
    PurchaseOrdersService,
    PurchaseReceptionsService,
    SupplierReturnsService,
  ],
})
export class PurchasesModule {}
