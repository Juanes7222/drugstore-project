import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { SuppliersService } from '../services/suppliers.service';
import { CreateSupplierDto, CreateSupplierSchema } from '../dto/create-supplier.dto';
import { UpdateSupplierDto, UpdateSupplierSchema } from '../dto/update-supplier.dto';
import { QuerySupplierDto } from '../dto/query-supplier.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { SyncAuthGuard } from '@/modules/sync/guards/sync-auth.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

@Controller('purchases/suppliers')
export class SuppliersController {
  constructor(private suppliersService: SuppliersService) {}

  @Get('sync')
  @UseGuards(SyncAuthGuard, RolesGuard)
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async sync(
    @Query('updatedSince') updatedSince?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<any> {
    return this.suppliersService.findSync({
      updatedSince,
      cursor: cursor ?? null,
      limit: limit ? Math.min(Math.max(Number(limit), 1), 500) : 200,
    });
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(@Query() query: QuerySupplierDto): Promise<any> {
    return this.suppliersService.findAll(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.suppliersService.findById(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  @Auditable({ action: AuditAction.CREATE, module: SystemModule.PURCHASES, entityType: 'Supplier' })
  async create(
    @Body(new ZodValidationPipe(CreateSupplierSchema)) createDto: CreateSupplierDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.suppliersService.create(createDto, user.id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  @Auditable({ action: AuditAction.UPDATE, module: SystemModule.PURCHASES, entityType: 'Supplier' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSupplierSchema)) updateDto: UpdateSupplierDto,
  ): Promise<any> {
    return this.suppliersService.update(id, updateDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  @HttpCode(204)
  @Auditable({ action: AuditAction.DELETE, module: SystemModule.PURCHASES, entityType: 'Supplier' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.suppliersService.remove(id);
  }
}
