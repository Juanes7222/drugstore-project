import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { PharmaceuticalFormsController } from './pharmaceutical-forms.controller';
import { PharmaceuticalFormsService } from './pharmaceutical-forms.service';
import { TaxSchemesController } from './tax-schemes.controller';
import { TaxSchemesService } from './tax-schemes.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    CatalogController,
    ProductsController,
    CategoriesController,
    PharmaceuticalFormsController,
    TaxSchemesController,
  ],
  providers: [
    CatalogService,
    ProductsService,
    CategoriesService,
    PharmaceuticalFormsService,
    TaxSchemesService,
  ],
  exports: [
    CatalogService,
    ProductsService,
    CategoriesService,
    PharmaceuticalFormsService,
    TaxSchemesService,
  ],
})
export class CatalogModule {}
