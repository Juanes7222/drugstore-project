import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import * as crypto from 'node:crypto';

/**
 * Result status for a DIAN transmission of an offline-generated invoice.
 */
export const INVOICE_RESULT_STATUS = {
  AUTHORIZED: 'AUTHORIZED',
  REJECTED: 'REJECTED',
} as const;

export type InvoiceResultStatus = (typeof INVOICE_RESULT_STATUS)[keyof typeof INVOICE_RESULT_STATUS];

/**
 * Input to record a DIAN transmission result for an offline contingency invoice.
 */
export interface SaveInvoiceTransmissionResultInput {
  invoiceId: string;
  workstationId: string;
  status: InvoiceResultStatus;
  cufeOfficial?: string | null;
  dianXml?: string | null;
  rejectionReason?: string | null;
  authorizedAt?: Date | null;
}

/**
 * Service responsible for recording DIAN transmission results for
 * offline-generated (contingency) invoices into the SyncInvoiceResult table.
 *
 * These results are polled by workstations via GET /sync/invoice-results
 * after they come back online, so they can update their local invoice
 * records with the official CUFE, DIAN XML, and transmission status.
 */
@Injectable()
export class InvoiceTransmissionResultService {
  private readonly logger = new Logger(InvoiceTransmissionResultService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * Saves a DIAN transmission result for the given invoice.
   *
   * If a result already exists for this invoiceId, it is updated in place
   * (the last transmission outcome is the authoritative one).
   *
   * Returns the saved SyncInvoiceResult id.
   */
  async saveResult(input: SaveInvoiceTransmissionResultInput): Promise<string> {
    const { invoiceId, workstationId, status, cufeOfficial, dianXml, rejectionReason, authorizedAt } = input;

    // Check for existing result (upsert by invoiceId)
    const existing = await this.prisma.syncInvoiceResult.findFirst({
      where: { invoiceId },
      select: { id: true },
    });

    const id = existing?.id ?? crypto.randomUUID();

    await this.prisma.syncInvoiceResult.upsert({
      where: { id },
      create: {
        id,
        invoiceId,
        workstationId,
        status,
        cufeOfficial: cufeOfficial ?? null,
        dianXml: dianXml ?? null,
        rejectionReason: rejectionReason ?? null,
        authorizedAt: authorizedAt ?? null,
      },
      update: {
        status,
        cufeOfficial: cufeOfficial ?? null,
        dianXml: dianXml ?? null,
        rejectionReason: rejectionReason ?? null,
        authorizedAt: authorizedAt ?? null,
      },
    });

    this.logger.log(
      `Saved DIAN transmission result for invoice ${invoiceId}: ${status}${cufeOfficial ? ` (CUFE: ${cufeOfficial.slice(0, 16)}...)` : ''}`,
    );

    return id;
  }

  /**
   * Queries invoice transmission results for a given workstation,
   * optionally filtered to results created after a specific date.
   *
   * Returns results ordered by createdAt ascending.
   */
  async findResultsForWorkstation(
    workstationId: string,
    since?: Date,
  ): Promise<Array<{
    id: string;
    invoiceId: string;
    workstationId: string;
    status: string;
    cufeOfficial: string | null;
    dianXml: string | null;
    rejectionReason: string | null;
    authorizedAt: Date | null;
    createdAt: Date;
  }>> {
    const where: Record<string, unknown> = { workstationId };

    if (since) {
      where.createdAt = { gte: since };
    }

    return this.prisma.syncInvoiceResult.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
  }
}
