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
import { SyncAuthGuard } from '@/modules/sync/guards/sync-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

@Controller('catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CatalogController {
  constructor(private catalogService: CatalogService) {}

  // Reference data read endpoints: @Public lets the POS bootstrap on first install
  // and resync with an expired token; @Roles is intentionally dropped so the
  // downstream RolesGuard (which rejects requests without request.user) does not
  // kill the request after JwtAuthGuard short-circuits.
  @Get('products')
  @Public()
  @UseGuards(SyncAuthGuard)
  async findAllProducts(@Query() query: QueryProductDto): Promise<any> {
    return this.catalogService.findAllProducts(query);
  }

  @Get('products/sync')
  @Public()
  @UseGuards(SyncAuthGuard)
  async syncProducts(
    @Query('updatedSince') updatedSince?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<any> {
    return this.catalogService.findProductsSync({
      updatedSince,
      cursor: cursor ?? null,
      limit: limit ? Math.min(Math.max(Number(limit), 1), 500) : 200,
    });
  }

  @Get('products/:id')
  @Public()
  @UseGuards(SyncAuthGuard)
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
  @Public()
  @UseGuards(SyncAuthGuard)
  async findAllCategories(): Promise<any> {
    return this.catalogService.findAllCategories();
  }

  @Get('pharmaceutical-forms')
  @Public()
  @UseGuards(SyncAuthGuard)
  async findAllPharmaceuticalForms(): Promise<any> {
    return this.catalogService.findAllPharmaceuticalForms();
  }

  @Get('tax-schemes')
  @Public()
  @UseGuards(SyncAuthGuard)
  async findAllTaxSchemes(): Promise<any> {
    return this.catalogService.findAllTaxSchemes();
  }
}
