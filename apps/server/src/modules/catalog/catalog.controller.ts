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
import { CatalogService } from './catalog.service';
import { CreateProductDto, CreateProductSchema } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

@Controller('catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CatalogController {
  constructor(private catalogService: CatalogService) {}

  @Get('products')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAllProducts(@Query() query: QueryProductDto): Promise<any> {
    return this.catalogService.findAllProducts(query);
  }

  @Get('products/:id')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findProductById(@Param('id') id: string): Promise<any> {
    return this.catalogService.findProductById(id);
  }

  @Post('products')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(201)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.CATALOG,
    entityType: 'Product',
  })
  async createProduct(
    @Body(new ZodValidationPipe(CreateProductSchema))
    createDto: CreateProductDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.catalogService.createProduct(user.id, createDto);
  }

  @Patch('products/:id')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CATALOG,
    entityType: 'Product',
  })
  async updateProduct(
    @Param('id') id: string,
    @Body() updateDto: UpdateProductDto,
  ): Promise<any> {
    return this.catalogService.updateProduct(id, updateDto);
  }

  @Get('categories')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAllCategories(): Promise<any> {
    return this.catalogService.findAllCategories();
  }

  @Get('pharmaceutical-forms')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAllPharmaceuticalForms(): Promise<any> {
    return this.catalogService.findAllPharmaceuticalForms();
  }

  @Get('tax-schemes')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAllTaxSchemes(): Promise<any> {
    return this.catalogService.findAllTaxSchemes();
  }
}
