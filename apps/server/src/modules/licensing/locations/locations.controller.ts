import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { RoleType } from '@pharmacy/shared-types';
import type { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleType.ADMIN)
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get('admin/subscriptions/:subscriptionId/locations')
  async findBySubscription(@Param('subscriptionId') subscriptionId: string) {
    return this.locationsService.findBySubscription(subscriptionId);
  }

  @Post('admin/subscriptions/:subscriptionId/locations')
  async create(@Param('subscriptionId') subscriptionId: string, @Body() dto: CreateLocationDto) {
    return this.locationsService.create(subscriptionId, dto);
  }

  @Get('admin/locations/:id')
  async findById(@Param('id') id: string) {
    return this.locationsService.findById(id);
  }

  @Patch('admin/locations/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.locationsService.update(id, dto);
  }

  @Post('admin/locations/:id/deactivate')
  async deactivate(@Param('id') id: string) {
    return this.locationsService.deactivate(id);
  }

  @Get('admin/subscriptions/:subscriptionId/location-limits')
  async getLocationLimitStatus(@Param('subscriptionId') subscriptionId: string) {
    return this.locationsService.getLocationLimitStatus(subscriptionId);
  }
}
