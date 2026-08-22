/**
 * Backoffice inventory alerts — pending adjustment approvals, low-stock
 * products, and lots expiring or already expired for the caller's tenant.
 * Read-only; approval stays in inventory-lots.
 */

import { Injectable } from '@nestjs/common';
import { User } from '@pharmacy/shared-types';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BackofficeScopeService } from './backoffice-scope.service';

const EXPIRING_LOT_DAYS = 90;
const ALERT_LIST_LIMIT = 100;

export interface InventoryAlertsResult {
  pendingAdjustments: unknown[];
  expiringLots: unknown[];
  expiredLots: unknown[];
  lowStock: {
    productId: string;
    commercialName: string;
    minimumStock: number;
    currentStock: number;
  }[];
}

@Injectable()
export class InventoryAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BackofficeScopeService,
  ) {}

  async getAlerts(user: User): Promise<InventoryAlertsResult> {
    const scope = this.scope.tenantWhere(user);
    const expiringBefore = new Date(
      Date.now() + EXPIRING_LOT_DAYS * 24 * 60 * 60 * 1000,
    );
    const now = new Date();

    const [pendingAdjustments, expiringLots, expiredLots, products, lotStock] =
      await Promise.all([
        this.prisma.inventoryAdjustmentDocument.findMany({
          where: {
            ...scope,
            submittedForApprovalAt: { not: null },
            approvedAt: null,
            rejectedAt: null,
          },
          orderBy: { submittedForApprovalAt: 'asc' },
          take: ALERT_LIST_LIMIT,
          select: {
            id: true,
            sequentialNumber: true,
            reason: true,
            notes: true,
            createdAt: true,
            submittedForApprovalAt: true,
            createdByUserId: true,
            createdByUser: { select: { displayName: true, fullName: true } },
          },
        }),
        this.prisma.lot.findMany({
          where: {
            currentStock: { gt: 0 },
            expirationDate: { gte: now, lte: expiringBefore },
            product: scope,
          },
          orderBy: { expirationDate: 'asc' },
          take: ALERT_LIST_LIMIT,
          select: {
            id: true,
            batchNumber: true,
            expirationDate: true,
            currentStock: true,
            productId: true,
            product: { select: { commercialName: true } },
          },
        }),
        this.prisma.lot.findMany({
          where: {
            currentStock: { gt: 0 },
            expirationDate: { lt: now },
            product: scope,
          },
          orderBy: { expirationDate: 'asc' },
          take: ALERT_LIST_LIMIT,
          select: {
            id: true,
            batchNumber: true,
            expirationDate: true,
            currentStock: true,
            productId: true,
            product: { select: { commercialName: true } },
          },
        }),
        this.prisma.product.findMany({
          where: { ...scope, isActive: true, minimumStock: { gt: 0 } },
          select: { id: true, commercialName: true, minimumStock: true },
        }),
        this.prisma.lot.groupBy({
          by: ['productId'],
          where: { state: 'ACTIVE', product: scope },
          _sum: { currentStock: true },
        }),
      ]);

    const stockByProduct = new Map(
      lotStock.map((g) => [g.productId, g._sum.currentStock ?? 0]),
    );
    const lowStock = products
      .filter((p) => (stockByProduct.get(p.id) ?? 0) < p.minimumStock)
      .map((p) => ({
        productId: p.id,
        commercialName: p.commercialName,
        minimumStock: p.minimumStock,
        currentStock: stockByProduct.get(p.id) ?? 0,
      }))
      .sort(
        (a, b) =>
          a.currentStock / a.minimumStock - b.currentStock / b.minimumStock,
      );

    return { pendingAdjustments, expiringLots, expiredLots, lowStock };
  }
}
