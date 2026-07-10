import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { RoleType } from '@pharmacy/shared-types';
import type { CreateSubscriptionDto, UpdateSubscriptionDto, RecordPaymentDto } from './dto/subscription.dto';

@Controller('admin/subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleType.ADMIN)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  async findAll(@Query() query: { status?: string; customerTaxId?: string; customerEmail?: string }) {
    return this.subscriptionsService.findAll(query);
  }

  @Post()
  async create(@Body() dto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(dto);
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.subscriptionsService.findById(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.subscriptionsService.update(id, dto);
  }

  @Post(':id/change-plan')
  async changePlan(@Param('id') id: string, @Body() body: { planId: string }) {
    return this.subscriptionsService.changePlan(id, body.planId);
  }

  @Post(':id/suspend')
  async suspend(@Param('id') id: string) {
    return this.subscriptionsService.suspend(id);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Body() body?: { cancelAtPeriodEnd?: boolean }) {
    return this.subscriptionsService.cancel(id, body?.cancelAtPeriodEnd ?? true);
  }

  @Post(':id/reactivate')
  async reactivate(@Param('id') id: string) {
    return this.subscriptionsService.reactivate(id);
  }

  @Post(':id/record-payment')
  async recordPayment(@Param('id') id: string, @Body() dto: RecordPaymentDto) {
    return this.subscriptionsService.recordPayment(id, dto);
  }
}
