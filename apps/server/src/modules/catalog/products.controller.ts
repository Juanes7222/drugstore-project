import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto, CreateProductSchema } from './dto/create-product.dto';
import { UpdateProductDto, UpdateProductSchema } from './dto/update-product.dto';
import { RegisterProductPriceDto, RegisterProductPriceSchema } from './dto/register-product-price.dto';
import { AssignProductTaxSchemeDto, AssignProductTaxSchemeSchema } from './dto/assign-product-tax-scheme.dto';
import { AddProductBarcodeDto, AddProductBarcodeSchema } from './dto/add-product-barcode.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(
    @Query('categoryId') categoryId?: string,
    @Query('isActive') isActive?: string,
    @Query('saleType') saleType?: string,
    @Query('search') search?: string,
  ): Promise<any> {
    const filters: any = {};

    if (categoryId) filters.categoryId = categoryId;
    if (isActive !== undefined) filters.isActive = isActive === 'true';
    if (saleType) filters.saleType = saleType;

    return (this.productsService as any).findAll(filters, search);
  }

  @Get(':id')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return (this.productsService as any).findById(id);
  }

  @Post()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(201)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.CATALOG,
    entityType: 'Product',
  })
  async create(
    @Body(new ZodValidationPipe(CreateProductSchema))
    dto: CreateProductDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.productsService.createProduct(user.id, dto);
  }

  @Patch(':id')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CATALOG,
    entityType: 'Product',
  })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProductSchema))
    dto: UpdateProductDto,
  ): Promise<any> {
    return this.productsService.updateProduct(id, dto);
  }

  @Post(':id/price')
  @Roles(RoleType.ADMIN)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CATALOG,
    entityType: 'ProductPriceHistory',
  })
  async registerPrice(
    @Param('id') productId: string,
    @Body(new ZodValidationPipe(RegisterProductPriceSchema))
    dto: RegisterProductPriceDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.productsService.registerPrice(productId, user.id, dto);
  }

  @Post(':id/tax-scheme')
  @Roles(RoleType.ADMIN)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CATALOG,
    entityType: 'ProductTaxHistory',
  })
  async assignTaxScheme(
    @Param('id') productId: string,
    @Body(new ZodValidationPipe(AssignProductTaxSchemeSchema))
    dto: AssignProductTaxSchemeDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.productsService.assignTaxScheme(productId, user.id, dto);
  }

  @Post(':id/barcodes')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(201)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.CATALOG,
    entityType: 'ProductBarcode',
  })
  async addBarcode(
    @Param('id') productId: string,
    @Body(new ZodValidationPipe(AddProductBarcodeSchema))
    dto: AddProductBarcodeDto,
  ): Promise<any> {
    return this.productsService.addBarcode(productId, dto);
  }

  @Patch(':id/barcodes/:barcodeId/primary')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CATALOG,
    entityType: 'ProductBarcode',
  })
  async setPrimaryBarcode(
    @Param('id') productId: string,
    @Param('barcodeId') barcodeId: string,
  ): Promise<any> {
    return this.productsService.setPrimaryBarcode(productId, barcodeId);
  }
}
