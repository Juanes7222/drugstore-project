import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { Prisma } from '@pharmacy/database';
import { paginateWithCursor } from '@/common/utils/cursor-pagination';

/**
 * POS InvoiceLocalAdjustment hydration — pull side for INVOICE_ADJUSTMENT push.
 *
 * POS pushes adjustments via sync handleInvoiceAdjustment (upserts
 * InvoiceLocalAdjustment on server). A second workstation hydrating the same
 * invoice set would otherwise have 0 adjustments. This cursor endpoint mirrors
 * FiscalDocumentsService.findSync / SalesService.findSync but for
 * InvoiceLocalAdjustment, returning raw rows so the POS can upsert its local
 * table.
 */
@Injectable()
export class InvoiceAdjustmentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Sync-pull invoice adjustments for POS hydration.
   *
   * Walks (createdAt asc, id asc) — InvoiceLocalAdjustment has createdAt + id,
   * no updatedAt. Incremental pulls filter createdAt >= updatedSince.
   * Tenant isolation: explicit subscriptionId filter.
   * Shape: { data, nextCursor, hasMore } — mirrors catalog / fiscal sync.
   */
  async findSync(input: {
    updatedSince?: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<{
    data: unknown[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const baseWhere: Prisma.InvoiceLocalAdjustmentWhereInput = {
      subscriptionId: this.tenantContext.getSubscriptionId(),
    };
    if (input.updatedSince) {
      baseWhere.createdAt = { gte: new Date(input.updatedSince) };
    }

    const page = await paginateWithCursor<
      unknown,
      Prisma.InvoiceLocalAdjustmentWhereInput,
      Prisma.InvoiceLocalAdjustmentOrderByWithRelationInput
    >({
      model: this.prisma.invoiceLocalAdjustment,
      baseWhere,
      limit: input.limit ?? 200,
      cursor: input.cursor ?? null,
      timeField: 'createdAt',
      direction: 'asc',
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return {
      data: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }
}
