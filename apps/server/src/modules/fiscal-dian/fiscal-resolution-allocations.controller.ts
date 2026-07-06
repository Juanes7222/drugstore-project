import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { RoleType, AuditAction, SystemModule, User } from '@pharmacy/shared-types';
import { FiscalResolutionAllocationsService } from './fiscal-resolution-allocations.service';
import { CreateFiscalResolutionAllocationSchema } from './dto/create-fiscal-resolution-allocation.dto';
import { CreateFiscalResolutionAllocationDto } from './dto/create-fiscal-resolution-allocation.dto';

@Controller('fiscal-dian/resolution-allocations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FiscalResolutionAllocationsController {
  constructor(
    private readonly service: FiscalResolutionAllocationsService,
  ) {}

  @Get()
  @Roles(RoleType.ADMIN)
  async findAll(
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 20,
  ): Promise<any> {
    return this.service.findAll(Number(page), Number(pageSize));
  }

  @Get(':id')
  @Roles(RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.service.findById(id);
  }

  @Post()
  @Roles(RoleType.ADMIN)
  @HttpCode(201)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.FISCAL,
    entityType: 'FiscalResolutionAllocation',
  })
  async create(
    @Body(new ZodValidationPipe(CreateFiscalResolutionAllocationSchema))
    dto: CreateFiscalResolutionAllocationDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.service.create(dto, user.id);
  }
}
