import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { FiscalResolutionsService } from '../services/fiscal-resolutions.service';
import { CreateFiscalResolutionDto } from '../dto/create-fiscal-resolution.dto';
import { CreateFiscalResolutionSchema } from '../dto/create-fiscal-resolution.schema';
import { QueryFiscalResolutionsDto } from '../dto/query-fiscal-resolutions.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { Body } from '@nestjs/common';
import { AuditAction, SystemModule, RoleType } from '@pharmacy/shared-types';

@Controller('fiscal-dian/resolutions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FiscalResolutionsController {
  constructor(private readonly service: FiscalResolutionsService) {}

  @Get()
  @Roles(RoleType.ADMIN)
  async findAll(@Query() query: QueryFiscalResolutionsDto): Promise<any> {
    return this.service.findAll(query);
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
    entityType: 'FiscalResolution',
  })
  async create(
    @Body(new ZodValidationPipe(CreateFiscalResolutionSchema))
    dto: CreateFiscalResolutionDto,
  ): Promise<any> {
    return this.service.create(dto);
  }
}
