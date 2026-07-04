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
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, CreateCategorySchema } from './dto/create-category.dto';
import { UpdateCategoryDto, UpdateCategorySchema } from './dto/update-category.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { AuditAction, SystemModule, RoleType } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

@Controller('categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CategoriesController {
  constructor(private categoriesService: CategoriesService) {}

  @Get()
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(): Promise<any> {
    return this.categoriesService.findAll();
  }

  @Get(':id')
  @Roles(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.categoriesService.findById(id);
  }

  @Post()
  @Roles(RoleType.ADMIN)
  @HttpCode(201)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.CATALOG,
    entityType: 'Category',
  })
  async create(
    @Body(new ZodValidationPipe(CreateCategorySchema))
    dto: CreateCategoryDto,
  ): Promise<any> {
    return this.categoriesService.create(dto);
  }

  @Patch(':id')
  @Roles(RoleType.ADMIN)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CATALOG,
    entityType: 'Category',
  })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCategorySchema))
    dto: UpdateCategoryDto,
  ): Promise<any> {
    return this.categoriesService.update(id, dto);
  }
}
