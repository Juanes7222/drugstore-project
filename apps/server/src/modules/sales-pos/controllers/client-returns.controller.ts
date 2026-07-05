import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ClientReturnsService } from '../services/client-returns.service';
import {
  CreateClientReturnDto,
  CreateClientReturnSchema,
} from '../dto/create-client-return.dto';
import {
  RejectClientReturnDto,
  RejectClientReturnSchema,
} from '../dto/reject-client-return.dto';
import {
  AnnulClientReturnDto,
  AnnulClientReturnSchema,
} from '../dto/annul-client-return.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

@Controller('sales-pos/client-returns')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientReturnsController {
  constructor(private clientReturnsService: ClientReturnsService) {}

  @Get()
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('state') state?: string,
  ): Promise<any> {
    return this.clientReturnsService.findAll({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      state,
    });
  }

  @Get(':id')
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  async findOne(@Param('id') id: string): Promise<any> {
    return this.clientReturnsService.findOne(id);
  }

  @Post()
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.SALES,
    entityType: 'ClientReturn',
  })
  async create(
    @Body(new ZodValidationPipe(CreateClientReturnSchema))
    createDto: CreateClientReturnDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.clientReturnsService.create(createDto, user.id, (user as any).workstationId);
  }

  @Post(':id/pending-pickup')
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.SALES,
    entityType: 'ClientReturn',
  })
  async markPendingPickup(@Param('id') id: string): Promise<any> {
    return this.clientReturnsService.markPendingPickup(id);
  }

  @Post(':id/confirm')
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.SALES,
    entityType: 'ClientReturn',
  })
  async confirm(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.clientReturnsService.confirm(id, user.id);
  }

  @Post(':id/reject')
  @Roles(RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.SALES,
    entityType: 'ClientReturn',
  })
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RejectClientReturnSchema))
    rejectDto: RejectClientReturnDto,
  ): Promise<any> {
    return this.clientReturnsService.reject(id, rejectDto);
  }

  @Post(':id/annul')
  @Roles(RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.SALES,
    entityType: 'ClientReturn',
  })
  async annul(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AnnulClientReturnSchema))
    annulDto: AnnulClientReturnDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.clientReturnsService.annul(id, user.id, annulDto);
  }
}
