import { Controller, Post, Get, Query, Body, Req, Param, UseGuards } from '@nestjs/common';
import { CheckInsService } from './check-ins.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { RoleType } from '@pharmacy/shared-types';
import type { CheckInDto } from './dto/check-in.dto';
import type { Request } from 'express';

@Controller()
export class CheckInsController {
  constructor(private readonly checkInsService: CheckInsService) {}

  @Post('public/licensing/check-in')
  @Public()
  async checkIn(@Body() dto: CheckInDto, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.checkInsService.checkIn(dto, ip);
  }

  @Get('admin/activations/:id/check-ins')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleType.ADMIN)
  async getCheckInHistory(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.checkInsService.getCheckInHistory(id, limit ? Math.min(parseInt(limit, 10), 100) : 10);
  }
}
