import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { PlansService } from './plans.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { RoleType } from '@pharmacy/shared-types';
import { Public } from '@/common/decorators/public.decorator';
import type { CreatePlanDto, UpdatePlanDto, PlanFilterDto } from './dto/plan.dto';

@Controller()
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  // Admin endpoints
  @Get('admin/plans')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async findAll(@Query() filter: PlanFilterDto) {
    return this.plansService.findAll(filter);
  }

  @Post('admin/plans')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async create(@Body() dto: CreatePlanDto) {
    return this.plansService.create(dto);
  }

  @Get('admin/plans/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async findById(@Param('id') id: string) {
    return this.plansService.findById(id);
  }

  @Patch('admin/plans/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.plansService.update(id, dto);
  }

  @Delete('admin/plans/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async remove(@Param('id') id: string) {
    return this.plansService.softDelete(id);
  }

  // Public endpoints
  @Get('public/plans')
  @Public()
  async findPublic() {
    return this.plansService.findPublic();
  }
}
