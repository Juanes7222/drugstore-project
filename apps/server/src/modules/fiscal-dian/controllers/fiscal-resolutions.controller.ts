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
import { FiscalResolutionsService } from '../services/fiscal-resolutions.service';
import { CreateFiscalResolutionDto } from '../dto/create-fiscal-resolution.dto';
import { QueryFiscalResolutionsDto } from '../dto/query-fiscal-resolutions.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { AuditAction, SystemModule, RoleType } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { CreateFiscalResolutionSchema } from '../dto/create-fiscal-resolution.schema';

@Controller('fiscal-dian/resolutions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FiscalResolutionsController {
  constructor(private fiscalResolutionsService: FiscalResolutionsService) {}

  @Get()
  @Roles(RoleType.ACCOUNTANT, RoleType.ADMIN)
  async findAll(@Query() query: QueryFiscalResolutionsDto): Promise<any> {
    return this.fiscalResolutionsService.findAll(query);
  }

  @Get(':id')
  @Roles(RoleType.ACCOUNTANT, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.fiscalResolutionsService.findById(id);
  }

  @Post()
  @Roles(RoleType.ACCOUNTANT, RoleType.ADMIN)
  @HttpCode(201)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.FISCAL,
    entityType: 'FiscalResolution',
  })
  async create(
    @Body(new ZodValidationPipe(CreateFiscalResolutionSchema))
    createDto: CreateFiscalResolutionDto,
  ): Promise<any> {
    return this.fiscalResolutionsService.create(createDto);
  }
}
