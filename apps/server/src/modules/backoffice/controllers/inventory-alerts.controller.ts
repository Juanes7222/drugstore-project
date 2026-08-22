/**
 * Backoffice inventory-alerts controller — pending adjustments, low stock,
 * and expiring/expired lots.
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RoleType, User } from '@pharmacy/shared-types';
import { InventoryAlertsService } from '../services/inventory-alerts.service';

@Controller('backoffice')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryAlertsController {
  constructor(private readonly inventoryAlerts: InventoryAlertsService) {}

  /**
   * GET /backoffice/inventory-alerts — alertas de inventario del tenant:
   * ajustes pendientes de aprobación, stock bajo, lotes por vencer y
   * vencidos.
   */
  @Get('inventory-alerts')
  @Roles(RoleType.ADMIN)
  getAlerts(@CurrentUser() user: User) {
    return this.inventoryAlerts.getAlerts(user);
  }
}
