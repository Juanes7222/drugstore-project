import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ActivationsService } from './activations.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { RoleType } from '@pharmacy/shared-types';
import type { ActivateDto, GenerateActivationCodeDto } from './dto/activation.dto';
import type { Request } from 'express';

@Controller()
export class ActivationsController {
  constructor(private readonly activationsService: ActivationsService) {}

  // Public: workstation activation
  @Post('public/licensing/activate')
  @Public()
  async activate(@Body() dto: ActivateDto, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.activationsService.activate(dto, ip);
  }

  // Admin: generate activation codes
  @Post('admin/subscriptions/:id/generate-activation-code')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async generateCode(@Param('id') id: string, @Body() dto: GenerateActivationCodeDto) {
    return this.activationsService.generateActivationCode(id, dto);
  }

  // Admin: list activations for a subscription
  @Get('admin/subscriptions/:id/activations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async findBySubscription(@Param('id') id: string) {
    return this.activationsService.findBySubscription(id);
  }

  // Admin: list activations for a location
  @Get('admin/locations/:id/activations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async findByLocation(@Param('id') id: string) {
    return this.activationsService.findByLocation(id);
  }

  // Admin: revoke an activation
  @Post('admin/activations/:id/revoke')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async revoke(@Param('id') id: string, @Body() body?: { reason?: string }) {
    return this.activationsService.revoke(id, body?.reason);
  }

  // Admin: get activation status details
  @Get('admin/activations/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async getStatus(@Param('id') id: string) {
    return this.activationsService.getActivationStatus(id);
  }
}
