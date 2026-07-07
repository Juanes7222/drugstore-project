import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  Headers,
} from '@nestjs/common';
import { SalesService } from '../services/sales.service';
import { CreateSaleDto } from '../dto/create-sale.dto';
import { QuerySaleDto } from '../dto/query-sale.dto';
import { ConfirmSaleDto, ConfirmSaleSchema } from '../dto/confirm-sale.dto';
import { AnnulSaleDto, AnnulSaleSchema } from '../dto/annul-sale.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { CreateSaleSchema } from '@pharmacy/shared-validation';

@Controller('sales-pos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesController {
  constructor(private salesService: SalesService) {}

  @Get()
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  async findAll(@Query() query: QuerySaleDto): Promise<any> {
    return this.salesService.findAll(query);
  }

  @Get(':id')
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.salesService.findById(id);
  }

  @Post()
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  @Auditable({ action: AuditAction.CREATE, module: SystemModule.SALES, entityType: 'Sale' })
  async create(
    @Body(new ZodValidationPipe(CreateSaleSchema)) createDto: CreateSaleDto,
    @CurrentUser() user: User,
    @Headers('x-workstation-id') workstationId?: string,
  ): Promise<any> {
    return this.salesService.create(createDto, user.id, workstationId || '');
  }

  @Post(':id/confirm')
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({ action: AuditAction.UPDATE, module: SystemModule.SALES, entityType: 'Sale' })
  async confirm(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ConfirmSaleSchema)) confirmDto: ConfirmSaleDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.salesService.confirm(id, confirmDto, user.id);
  }

  @Post(':id/annul')
  @Roles(RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({ action: AuditAction.STATE_CHANGE, module: SystemModule.SALES, entityType: 'Sale' })
  async annul(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AnnulSaleSchema)) annulDto: AnnulSaleDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.salesService.annul(id, annulDto, user.id);
  }
}
