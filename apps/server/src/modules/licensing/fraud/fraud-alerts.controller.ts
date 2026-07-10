import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpStatus } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DomainException } from '@/common/exceptions/domain.exception';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { RoleType } from '@pharmacy/shared-types';

@Controller('admin/licensing/fraud')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleType.ADMIN)
export class FraudAlertsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll(@Query() query: { status?: string; severity?: string }) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;

    return this.prisma.fraudAlert.findMany({
      where,
      include: {
        subscription: { select: { customerName: true, customerTaxId: true } },
      },
      orderBy: { detectedAt: 'desc' },
      take: 100,
    });
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    const alert = await this.prisma.fraudAlert.findUnique({
      where: { id },
      include: {
        subscription: { select: { customerName: true, customerTaxId: true, customerEmail: true } },
        workstationActivation: { select: { workstationName: true, hardwareFingerprint: true } },
      },
    });
    if (!alert) {
      throw new DomainException('FRAUD_ALERT_NOT_FOUND', 'Fraud alert not found', HttpStatus.NOT_FOUND);
    }
    return alert;
  }

  @Post(':id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() body: { action: 'DISMISSED' | 'CONFIRMED_FRAUD'; resolutionNotes?: string },
  ) {
    const alert = await this.prisma.fraudAlert.findUnique({ where: { id } });
    if (!alert) {
      throw new DomainException('FRAUD_ALERT_NOT_FOUND', 'Fraud alert not found', HttpStatus.NOT_FOUND);
    }

    return this.prisma.fraudAlert.update({
      where: { id },
      data: {
        status: body.action,
        resolvedAt: new Date(),
        resolutionNotes: body.resolutionNotes ?? null,
      },
    });
  }
}
