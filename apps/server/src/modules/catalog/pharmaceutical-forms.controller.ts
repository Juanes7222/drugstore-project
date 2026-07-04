import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { PharmaceuticalFormsService } from './pharmaceutical-forms.service';
import { CreatePharmaceuticalFormDto, CreatePharmaceuticalFormSchema } from './dto/create-pharmaceutical-form.dto';
import { UpdatePharmaceuticalFormDto, UpdatePharmaceuticalFormSchema } from './dto/update-pharmaceutical-form.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { AuditAction, SystemModule, RoleType } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

@Controller('pharmaceutical-forms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PharmaceuticalFormsController {
  constructor(private pharmaceuticalFormsService: PharmaceuticalFormsService) {}

  @Get()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(): Promise<any> {
    return this.pharmaceuticalFormsService.findAll();
  }

  @Get(':id')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.pharmaceuticalFormsService.findById(id);
  }

  @Post()
  @Roles(RoleType.ADMIN)
  @HttpCode(201)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.CATALOG,
    entityType: 'PharmaceuticalForm',
  })
  async create(
    @Body(new ZodValidationPipe(CreatePharmaceuticalFormSchema))
    dto: CreatePharmaceuticalFormDto,
  ): Promise<any> {
    return this.pharmaceuticalFormsService.create(dto);
  }

  @Patch(':id')
  @Roles(RoleType.ADMIN)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CATALOG,
    entityType: 'PharmaceuticalForm',
  })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePharmaceuticalFormSchema))
    dto: UpdatePharmaceuticalFormDto,
  ): Promise<any> {
    return this.pharmaceuticalFormsService.update(id, dto);
  }
}
