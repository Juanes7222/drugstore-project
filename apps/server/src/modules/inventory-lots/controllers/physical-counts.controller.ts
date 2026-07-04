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
import { PhysicalCountsService } from '../services/physical-counts.service';
import {
  StartPhysicalCountDto,
  StartPhysicalCountSchema,
} from '../dto/start-physical-count.dto';
import {
  RegisterPhysicalCountLineDto,
  RegisterPhysicalCountLineSchema,
} from '../dto/register-physical-count-line.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

@Controller('inventory-lots/physical-counts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PhysicalCountsController {
  constructor(private physicalCountsService: PhysicalCountsService) {}

  @Get()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('state') state?: string,
  ): Promise<any> {
    return this.physicalCountsService.findAll({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      state,
    });
  }

  @Get(':id')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findOne(@Param('id') id: string): Promise<any> {
    return this.physicalCountsService.findOne(id);
  }

  @Post()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.INVENTORY,
    entityType: 'PhysicalCount',
  })
  async start(
    @Body(new ZodValidationPipe(StartPhysicalCountSchema))
    startDto: StartPhysicalCountDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.physicalCountsService.start(startDto, user.id);
  }

  @Post(':id/count-lines')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.INVENTORY,
    entityType: 'PhysicalCount',
  })
  async registerCount(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RegisterPhysicalCountLineSchema))
    registerDto: RegisterPhysicalCountLineDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.physicalCountsService.registerCount(id, registerDto, user.id);
  }

  @Post(':id/finish')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.INVENTORY,
    entityType: 'PhysicalCount',
  })
  async finish(
    @Param('id') id: string,
  ): Promise<any> {
    return this.physicalCountsService.finish(id);
  }

  @Post(':id/review')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.INVENTORY,
    entityType: 'PhysicalCount',
  })
  async review(
    @Param('id') id: string,
  ): Promise<any> {
    return this.physicalCountsService.review(id);
  }

  @Post(':id/approve')
  @Roles(RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.INVENTORY,
    entityType: 'PhysicalCount',
  })
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.physicalCountsService.approve(id, user.id);
  }

  @Post(':id/apply')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.INVENTORY,
    entityType: 'PhysicalCount',
  })
  async apply(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.physicalCountsService.apply(id, user.id);
  }

  @Post(':id/annul')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({
    action: AuditAction.STATE_CHANGE,
    module: SystemModule.INVENTORY,
    entityType: 'PhysicalCount',
  })
  async annul(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.physicalCountsService.annul(id, user.id);
  }
}
