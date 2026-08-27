import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InvoiceAdjustmentService } from '../services/invoice-adjustment.service';
import { SyncAuthGuard } from '@/modules/sync/guards/sync-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { RoleType } from '@pharmacy/shared-types';

/**
 * InvoiceLocalAdjustment hydration sync — POS pull side.
 *
 * Complements the INVOICE_ADJUSTMENT push via sync (handleInvoiceAdjustment
 * upserts InvoiceLocalAdjustment on server) with a pull endpoint so a second
 * workstation can hydrate adjustments made on another device.
 *
 * Cursor-walks (createdAt asc, id asc) — InvoiceLocalAdjustment has no
 * updatedAt. Tenant isolated via subscriptionId.
 * Shape: { data: InvoiceLocalAdjustment[], nextCursor, hasMore } — raw rows.
 */
@Controller('fiscal-dian/adjustments')
export class FiscalInvoiceAdjustmentSyncController {
  constructor(private readonly invoiceAdjustmentService: InvoiceAdjustmentService) {}

  @Get('sync')
  @UseGuards(SyncAuthGuard, RolesGuard)
  @Roles(RoleType.CASHIER, RoleType.ADMIN)
  async sync(
    @Query('updatedSince') updatedSince?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<{ data: unknown[]; nextCursor: string | null; hasMore: boolean }> {
    return this.invoiceAdjustmentService.findSync({
      updatedSince,
      cursor: cursor ?? null,
      limit: limit ? Math.min(Math.max(Number(limit), 1), 500) : 200,
    });
  }
}
