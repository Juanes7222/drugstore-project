import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { FiscalDocumentsService } from '../services/fiscal-documents.service';
import { SyncAuthGuard } from '@/modules/sync/guards/sync-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { RoleType } from '@pharmacy/shared-types';

/**
 * Fiscal Invoice hydration sync — POS pull side.
 *
 * POS has a local-only Invoice table (schema-local/models/fiscal.prisma) that
 * is populated per sale via InvoiceService.generateInvoiceForSale on the
 * originating workstation. A second workstation hydrating the same sale via
 * GET /sales-pos/sync would otherwise have no Invoice rows for those sales.
 *
 * This cursor endpoint mirrors SalesService.findSync / GET /sales-pos/sync
 * but for FiscalDocuments, mapped to an Invoice-like shape with fullData so
 * the POS can upsert its local Invoice table during hydration.
 *
 * Server has no Invoice table (local-only), so FiscalDocument is the source
 * — see FiscalDocumentsService.findSync / mapFiscalDocumentToInvoiceSync for
 * the alias synthesis (invoiceNumber = fullNumber, etc.). If a server-side
 * Invoice is ever added, replace that mapping with a direct query.
 *
 * Path chosen as GET /fiscal-dian/invoices/sync to sit next to the existing
 * fiscal route GET /fiscal-dian/documents (same module, reuses the same
 * service) rather than a top-level GET /invoices/sync that would cross module
 * ownership.
 *
 * Shape: { data, nextCursor, hasMore } — POS handles both this and catalog
 * { items, nextCursor, hasMore } shapes.
 */
@Controller('fiscal-dian/invoices')
export class FiscalInvoiceSyncController {
  constructor(private readonly fiscalDocumentsService: FiscalDocumentsService) {}

  @Get('sync')
  @UseGuards(SyncAuthGuard, RolesGuard)
  @Roles(RoleType.CASHIER, RoleType.ADMIN, RoleType.ACCOUNTANT)
  async sync(
    @Query('updatedSince') updatedSince?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<{ data: unknown[]; nextCursor: string | null; hasMore: boolean }> {
    return this.fiscalDocumentsService.findSync({
      updatedSince,
      cursor: cursor ?? null,
      limit: limit ? Math.min(Math.max(Number(limit), 1), 500) : 200,
    });
  }
}
