/**
 * Local invoice generation service for DIAN contingency compliance.
 *
 * Generates provisional fiscal documents (invoices, credit notes,
 * cancellations) when the terminal is offline, computes the provisional
 * CUFE using the workstation-local contingency tech key, and queues them
 * for DIAN transmission via the SyncQueue when connectivity returns.
 *
 * ## Lifecycle
 *
 * 1. generateInvoiceForSale() — called from SalesPosService.confirm() after
 *    the local sale commits. Creates an Invoice record with status
 *    CONTINGENCY_PENDING_TRANSMISSION if in contingency mode, or
 *    TRANSMITTED_AUTHORIZED placeholder if online.
 * 2. generateCreditNoteForReturn() — called from ReturnsService.confirm().
 *    Creates a CREDIT_NOTE linked to the original invoice.
 * 3. cancelInvoice() — creates a CONTINGENCY_CANCELLATION document.
 * 4. applyTransmissionResult() — called when the server returns an
 *    INVOICE_TRANSMISSION_RESULT, updating the local invoice with the
 *    official CUFE and DIAN response.
 */

import type { PrismaClient, Prisma } from '@pharmacy/database/local';
import {
  CONTINGENCY_TECH_KEY,
  CONTINGENCY_TRANSMISSION_WINDOW_HOURS,
} from '../../config/fiscal';
import type {
  InvoiceFullData,
  InvoiceLineItem,
  InvoicePayment,
  InvoiceTaxSummary,
  InvoiceBuyer,
  InvoiceSeller,
  InvoiceModel,
  InvoiceListItem,
  InvoiceType,
  InvoiceStatus,
  CreditNoteInput,
} from './fiscal-types';

// Re-export for callers (returns.service.ts)
export type { CreditNoteInput } from './fiscal-types';

import { calculateProvisionalCufe } from './cufe';
import type { ContingencyService } from './contingency.service';
import type { FiscalNumberingService } from './numbering.service';
import {
  InvoiceNotFoundException,
  InvoiceNotCancellableException,
  SaleMissingForInvoiceException,
  ContingencyTechKeyPlaceholderError,
} from './exceptions';
import { isContingencyTechKeyPlaceholder } from '../../config/fiscal';

export interface InvoiceServiceConfig {
  prisma: PrismaClient;
  workstationId: string;
  numberingService: FiscalNumberingService;
  contingencyService: ContingencyService;
}

export interface InvoiceService {
  /**
   * Generate an invoice for a confirmed sale.
   *
   * Called from SalesPosService.confirm() after the local sale commits.
   * Creates the full fiscal document, computes the provisional CUFE, and
   * inserts it into the SyncQueue for transmission if in contingency mode.
   */
  generateInvoiceForSale(saleId: string): Promise<InvoiceModel>;

  /**
   * Generate a credit note for a completed client return.
   *
   * Called from ReturnsService.confirm() after the return commits.
   * Accepts the return data directly (CreditNoteInput) so the invoice
   * service does not need to query the returns table, which may not
   * be available in the local Prisma schema.
   *
   * @param input  Return data prepared by the caller.
   */
  generateCreditNoteForReturn(input: CreditNoteInput): Promise<InvoiceModel>;

  /**
   * Cancel an invoice before DIAN transmission.
   *
   * Creates a CONTINGENCY_CANCELLATION document referencing the original.
   * Only available when status is CONTINGENCY_PENDING_TRANSMISSION or
   * TRANSMITTED_AUTHORIZED (before end-of-day reporting).
   */
  cancelInvoice(invoiceId: string, reason: string): Promise<InvoiceModel>;

  /**
   * Apply the result of DIAN transmission (from SyncQueue result polling).
   * Updates the local Invoice with official CUFE, DIAN XML, and new status.
   */
  applyTransmissionResult(input: {
    invoiceId: string;
    status: 'TRANSMITTED_AUTHORIZED' | 'TRANSMITTED_REJECTED';
    cufeOfficial?: string;
    dianXml?: string;
    rejectionReason?: string;
    authorizedAt?: string;
  }): Promise<InvoiceModel>;

  /** Find an invoice by its UUID. */
  findById(invoiceId: string): Promise<InvoiceModel | null>;

  /** Find invoices by sale ID. */
  findBySaleId(saleId: string): Promise<InvoiceModel[]>;

  /**
   * List invoices with optional filters for the fiscal management page.
   */
  listInvoices(filters?: {
    status?: InvoiceStatus;
    invoiceType?: InvoiceType;
    contingencyOnly?: boolean;
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ items: InvoiceListItem[]; total: number }>;

  /**
   * Get the pending-contingency invoices whose window is approaching expiry.
   */
  findExpiringWithin(hours: number): Promise<InvoiceModel[]>;

  /**
   * Find invoices where expiresAt < now() (expired).
   */
  findExpired(): Promise<InvoiceModel[]>;

  /**
   * Mark an invoice as EXPIRED_CONTINGENCY. Called by the fiscal scheduler
   * when the transmission window elapses.
   */
  markInvoiceAsExpired(invoiceId: string): Promise<InvoiceModel>;

  /**
   * Reissue a single transmission sync entry for a contingency invoice.
   * Called by the sync scheduler when connectivity is restored.
   */
  queueInvoiceForTransmission(
    invoiceId: string,
  ): Promise<void>;

  /**
   * Pull pending invoice transmission results from the server and apply them
   * locally. Called by the sync scheduler during each sync cycle.
   *
   * @param baseUrl  Server base URL
   * @param accessToken  Optional auth token
   * @returns Number of results applied
   */
  pullAndApplyResults(
    baseUrl: string,
    accessToken?: string,
  ): Promise<number>;
}

export const createInvoiceService = (
  config: InvoiceServiceConfig,
): InvoiceService => {
  return new InvoiceServiceImpl(config);
};

class InvoiceServiceImpl implements InvoiceService {
  private readonly prisma: PrismaClient;
  private readonly workstationId: string;
  private readonly numbering: FiscalNumberingService;
  private readonly contingency: ContingencyService;

  constructor(config: InvoiceServiceConfig) {
    this.prisma = config.prisma;
    this.workstationId = config.workstationId;
    this.numbering = config.numberingService;
    this.contingency = config.contingencyService;
  }

  async generateInvoiceForSale(saleId: string): Promise<InvoiceModel> {
    const isContingency = await this.contingency.isInContingency();
    const activeEvent = isContingency
      ? await this.prisma.contingencyEvent.findFirst({
          where: { workstationId: this.workstationId, endedAt: null },
        })
      : null;

    if (isContingencyTechKeyPlaceholder()) {
      throw new ContingencyTechKeyPlaceholderError();
    }

    return this.prisma.$transaction(async (tx) => {
      const sale = await this.buildSaleSnapshot(tx, saleId);
      if (!sale) throw new SaleMissingForInvoiceException(saleId);

      const invoiceNumber = await this.numbering.nextNumber(
        'ELECTRONIC_INVOICE',
        isContingency,
        tx,
      );

      const fullData = this.buildInvoiceFullData(
        sale,
        invoiceNumber,
        null,
        null,
      );

      const cufeData = this.buildCufeData(fullData);
      const cufeProvisional = await calculateProvisionalCufe(
        cufeData,
        CONTINGENCY_TECH_KEY,
      );

      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + CONTINGENCY_TRANSMISSION_WINDOW_HOURS * 60 * 60 * 1000,
      );

      const invoice = await tx.invoice.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          saleId,
          workstationId: this.workstationId,
          invoiceType: 'ELECTRONIC_INVOICE',
          invoiceNumber,
          contingencyNumber: isContingency ? invoiceNumber : null,
          status: isContingency
            ? 'CONTINGENCY_PENDING_TRANSMISSION'
            : 'TRANSMITTED_AUTHORIZED',
          cufeProvisional,
          issuedAt: now,
          expiresAt,
          contingencyEventId: activeEvent?.id ?? null,
          techKeySnapshot: CONTINGENCY_TECH_KEY,
          fullData: fullData as unknown as Prisma.InputJsonValue,
        },
      });

      if (activeEvent && isContingency) {
        await this.contingency.incrementGenerated(activeEvent.id, tx);
      }

      // Only queue transmission if in contingency mode
      if (isContingency) {
        await this.buildAndInsertSyncQueueEntry(tx, invoice, fullData);
      }

      return invoice as unknown as InvoiceModel;
    });
  }

  async generateCreditNoteForReturn(input: CreditNoteInput): Promise<InvoiceModel> {
    const isContingency = await this.contingency.isInContingency();
    const activeEvent = isContingency
      ? await this.prisma.contingencyEvent.findFirst({
          where: { workstationId: this.workstationId, endedAt: null },
        })
      : null;

    if (isContingencyTechKeyPlaceholder()) {
      throw new ContingencyTechKeyPlaceholderError();
    }

    return this.prisma.$transaction(async (tx) => {
      // Look up the original invoice for this sale
      const originalInvoices = await tx.invoice.findMany({
        where: { saleId: input.saleId },
        orderBy: { issuedAt: 'desc' as const },
        take: 1,
      });
      const originalInvoice = originalInvoices[0] ?? null;

      const invoiceNumber = await this.numbering.nextNumber(
        'CREDIT_NOTE',
        isContingency,
        tx,
      );

      const fullData = this.buildCreditNoteFullData(
        input,
        invoiceNumber,
        originalInvoice?.invoiceNumber ?? null,
      );

      const cufeData = this.buildCufeData(fullData);
      const cufeProvisional = await calculateProvisionalCufe(
        cufeData,
        CONTINGENCY_TECH_KEY,
      );

      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + CONTINGENCY_TRANSMISSION_WINDOW_HOURS * 60 * 60 * 1000,
      );

      const invoice = await tx.invoice.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          saleId: input.saleId,
          workstationId: this.workstationId,
          invoiceType: 'CREDIT_NOTE',
          invoiceNumber,
          contingencyNumber: isContingency ? invoiceNumber : null,
          status: isContingency
            ? 'CONTINGENCY_PENDING_TRANSMISSION'
            : 'TRANSMITTED_AUTHORIZED',
          cufeProvisional,
          issuedAt: now,
          expiresAt,
          relatedInvoiceId: originalInvoice?.id ?? null,
          contingencyEventId: activeEvent?.id ?? null,
          techKeySnapshot: CONTINGENCY_TECH_KEY,
          fullData: fullData as unknown as Prisma.InputJsonValue,
        },
      });

      if (activeEvent && isContingency) {
        await this.contingency.incrementGenerated(activeEvent.id, tx);
      }

      if (isContingency) {
        await this.buildAndInsertSyncQueueEntry(tx, invoice, fullData);
      }

      return invoice as unknown as InvoiceModel;
    });
  }

  async cancelInvoice(
    invoiceId: string,
    _reason: string,
  ): Promise<InvoiceModel> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) throw new InvoiceNotFoundException(invoiceId);

    const cancellableStatuses: InvoiceStatus[] = [
      'CONTINGENCY_PENDING_TRANSMISSION',
      'TRANSMITTED_AUTHORIZED',
    ];

    if (!cancellableStatuses.includes(invoice.status as InvoiceStatus)) {
      throw new InvoiceNotCancellableException(invoiceId, invoice.status);
    }

    // Generate a CONTINGENCY_CANCELLATION document
    const isContingency = await this.contingency.isInContingency();
    const invoiceNumber = await this.numbering.nextNumber(
      'CONTINGENCY_CANCELLATION',
      isContingency,
    );

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + CONTINGENCY_TRANSMISSION_WINDOW_HOURS * 60 * 60 * 1000,
    );

    // Build a minimal fullData for the cancellation
    const fullData: InvoiceFullData = {
      invoiceType: 'CONTINGENCY_CANCELLATION',
      invoiceNumber,
      contingencyNumber: isContingency ? invoiceNumber : null,
      relatedInvoiceNumber: invoice.invoiceNumber,
      seller: {
        nit: '',
        name: '',
        address: null,
        phone: null,
        resolutionNumber: null,
        resolutionDate: null,
        resolutionPrefix: '',
      },
      buyer: {
        identificationType: null,
        identificationNumber: null,
        name: '',
        email: null,
        phone: null,
        address: null,
      },
      lineItems: [],
      taxSummaries: [],
      payments: [],
      subtotal: '0.00',
      totalDiscount: '0.00',
      totalTax: '0.00',
      totalAmount: '0.00',
      changeAmount: '0.00',
      issuedAt: now.toISOString(),
      currency: 'COP',
      prescriptionNumber: null,
      workstationCode: this.workstationId.slice(0, 8),
    };

    const cufeData = this.buildCufeData(fullData);
    const cufeProvisional = await calculateProvisionalCufe(
      cufeData,
      CONTINGENCY_TECH_KEY,
    );

    const cancellationInvoice = await this.prisma.invoice.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        saleId: invoice.saleId,
        workstationId: this.workstationId,
        invoiceType: 'CONTINGENCY_CANCELLATION',
        invoiceNumber,
        contingencyNumber: isContingency ? invoiceNumber : null,
        status: isContingency
          ? 'CONTINGENCY_PENDING_TRANSMISSION'
          : 'TRANSMITTED_AUTHORIZED',
        cufeProvisional,
        issuedAt: now,
        expiresAt,
        relatedInvoiceId: invoiceId,
        techKeySnapshot: CONTINGENCY_TECH_KEY,
        fullData: fullData as unknown as Prisma.InputJsonValue,
      },
    });

    // Mark the original invoice as cancelled
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'CANCELLED' },
    });

    return cancellationInvoice as unknown as InvoiceModel;
  }

  async applyTransmissionResult(input: {
    invoiceId: string;
    status: 'TRANSMITTED_AUTHORIZED' | 'TRANSMITTED_REJECTED';
    cufeOfficial?: string;
    dianXml?: string;
    rejectionReason?: string;
    authorizedAt?: string;
  }): Promise<InvoiceModel> {
    const updateData: Record<string, unknown> = {
      status: input.status,
      transmittedAt: new Date(),
    };

    if (input.cufeOfficial) updateData.cufeOfficial = input.cufeOfficial;
    if (input.dianXml) updateData.fiscalXml = input.dianXml;

    const invoice = await this.prisma.invoice.update({
      where: { id: input.invoiceId },
      data: updateData as Prisma.InvoiceUpdateInput,
    });

    // Remember to update the contingency event counts
    if (invoice.contingencyEventId && input.status === 'TRANSMITTED_AUTHORIZED') {
      await this.contingency.incrementTransmitted(invoice.contingencyEventId);
    }

    return invoice as unknown as InvoiceModel;
  }

  async findById(invoiceId: string): Promise<InvoiceModel | null> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    return invoice as unknown as InvoiceModel | null;
  }

  async findBySaleId(saleId: string): Promise<InvoiceModel[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: { saleId },
      orderBy: { issuedAt: 'desc' as const },
    });
    return invoices as unknown as InvoiceModel[];
  }

  async listInvoices(filters?: {
    status?: InvoiceStatus;
    invoiceType?: InvoiceType;
    contingencyOnly?: boolean;
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ items: InvoiceListItem[]; total: number }> {
    const where: Record<string, unknown> = {};

    if (filters?.status) where.status = filters.status;
    if (filters?.invoiceType) where.invoiceType = filters.invoiceType;
    if (filters?.contingencyOnly) {
      where.contingencyNumber = { not: null };
    }
    if (filters?.since || filters?.until) {
      const issuedAt: Record<string, Date> = {};
      if (filters.since) issuedAt.gte = filters.since;
      if (filters.until) issuedAt.lte = filters.until;
      where.issuedAt = issuedAt;
    }

    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { issuedAt: 'desc' as const },
        take: limit,
        skip: offset,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      items: items.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        contingencyNumber: inv.contingencyNumber,
        invoiceType: inv.invoiceType as InvoiceType,
        status: inv.status as InvoiceStatus,
        issuedAt: inv.issuedAt.toISOString(),
        expiresAt: inv.expiresAt?.toISOString() ?? null,
        cufeProvisional: inv.cufeProvisional,
        cufeOfficial: inv.cufeOfficial,
        totalAmount: String(inv.fullData && typeof inv.fullData === 'object' && 'totalAmount' in inv.fullData
          ? (inv.fullData as Record<string, unknown>).totalAmount
          : '0.00'),
        clientName: inv.fullData && typeof inv.fullData === 'object' && 'buyer' in inv.fullData
          ? ((inv.fullData as Record<string, unknown>).buyer as Record<string, unknown>)?.name as string ?? ''
          : '',
      })),
      total,
    };
  }

  async findExpiringWithin(hours: number): Promise<InvoiceModel[]> {
    const now = new Date();
    const deadline = new Date(now.getTime() + hours * 60 * 60 * 1000);

    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: 'CONTINGENCY_PENDING_TRANSMISSION',
        expiresAt: { lte: deadline, gte: now },
      },
      orderBy: { expiresAt: 'asc' as const },
    });

    return invoices as unknown as InvoiceModel[];
  }

  async findExpired(): Promise<InvoiceModel[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: 'CONTINGENCY_PENDING_TRANSMISSION',
        expiresAt: { lte: new Date() },
      },
      orderBy: { expiresAt: 'asc' as const },
    });

    return invoices as unknown as InvoiceModel[];
  }

  async markInvoiceAsExpired(invoiceId: string): Promise<InvoiceModel> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) throw new InvoiceNotFoundException(invoiceId);

    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'EXPIRED_CONTINGENCY' },
    });

    if (updated.contingencyEventId) {
      await this.contingency.incrementExpired(updated.contingencyEventId);
    }

    return updated as unknown as InvoiceModel;
  }

  async queueInvoiceForTransmission(invoiceId: string): Promise<void> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) throw new InvoiceNotFoundException(invoiceId);
    if (invoice.status !== 'CONTINGENCY_PENDING_TRANSMISSION') return;

    await this.prisma.$transaction(async (tx) => {
      const payload = {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        contingencyNumber: invoice.contingencyNumber,
        saleId: invoice.saleId,
        provisionalCufe: invoice.cufeProvisional,
        fullInvoiceData: invoice.fullData,
        workstationId: this.workstationId,
      };

      const payloadStr = JSON.stringify(payload);
      const payloadBytes = new TextEncoder().encode(payloadStr);
      const payloadHash = await this.computeHash(payloadStr);
      const operationUuid = globalThis.crypto.randomUUID();

      const latestSeq = await tx.syncQueue.findFirst({
        where: { sourceWorkstationId: this.workstationId },
        orderBy: { clientSequence: 'desc' },
        select: { clientSequence: true },
      });
      const clientSequence = latestSeq ? latestSeq.clientSequence + 1n : 1n;

      await tx.syncQueue.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          operationUuid,
          operationType: 'INVOICE_TRANSMISSION',
          payload: payloadStr,
          payloadHash,
          payloadSize: payloadBytes.length,
          versionSchema: 1,
          status: 'PENDING',
          retryCount: 0,
          sourceWorkstationId: this.workstationId,
          sourceCreatedAt: new Date(),
          clientSequence,
        },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  async pullAndApplyResults(
    baseUrl: string,
    accessToken?: string,
  ): Promise<number> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      // Get the most recent transmitted result timestamp for this workstation
      const latestResult = await this.prisma.invoice.findFirst({
        where: {
          workstationId: this.workstationId,
          transmittedAt: { not: null },
        },
        orderBy: { transmittedAt: 'desc' as const },
        select: { transmittedAt: true },
      });

      const since = latestResult?.transmittedAt?.toISOString() ?? new Date(0).toISOString();
      const normalizedBase = baseUrl.replace(/\/+$/, '');
      const url = `${normalizedBase}/sync/invoice-results?workstationId=${encodeURIComponent(this.workstationId)}&since=${encodeURIComponent(since)}`;

      const response = await fetch(url, { headers });
      if (!response.ok) {
        console.warn(`[InvoiceService] Poll invoice results failed: ${response.status}`);
        return 0;
      }

      const results = (await response.json()) as Array<{
        invoiceId: string;
        status: 'AUTHORIZED' | 'REJECTED';
        cufeOfficial?: string;
        dianXml?: string;
        rejectionReason?: string;
        authorizedAt?: string;
      }>;

      let appliedCount = 0;
      for (const result of results) {
        try {
          await this.applyTransmissionResult({
            invoiceId: result.invoiceId,
            status: result.status === 'AUTHORIZED'
              ? 'TRANSMITTED_AUTHORIZED'
              : 'TRANSMITTED_REJECTED',
            cufeOfficial: result.cufeOfficial,
            dianXml: result.dianXml,
            rejectionReason: result.rejectionReason,
            authorizedAt: result.authorizedAt,
          });
          appliedCount++;
        } catch (err) {
          console.error(
            `[InvoiceService] Failed to apply result for invoice ${result.invoiceId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      return appliedCount;
    } catch (err) {
      console.error('[InvoiceService] pullAndApplyResults error:', err);
      return 0;
    }
  }

  private async buildSaleSnapshot(
    tx: Prisma.TransactionClient,
    saleId: string,
  ): Promise<{
    id: string;
    clientId: string | null;
    clientNameSnapshot: string | null;
    clientIdentificationTypeSnapshot: string | null;
    clientIdentificationNumberSnapshot: string | null;
    subtotal: Prisma.Decimal;
    totalDiscount: Prisma.Decimal;
    totalTax: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    changeAmount: Prisma.Decimal;
    items: Array<{
      productCommercialNameSnapshot: string;
      productInternalCodeSnapshot: string;
      productGenericNameSnapshot: string | null;
      productConcentrationSnapshot: string | null;
      quantity: number;
      unitPrice: Prisma.Decimal;
      taxRate: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      discountPercentage: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      discountReason: string | null;
      subtotal: Prisma.Decimal;
      total: Prisma.Decimal;
    }>;
    payments: Array<{
      paymentMethodId: string;
      amount: Prisma.Decimal;
      transactionReference: string | null;
      authorizationCode: string | null;
      cardBrand: string | null;
      cardLastFour: string | null;
      paymentMethod?: {
        name: string;
        category: string;
      } | null;
    }>;
  } | null> {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      include: {
        items: true,
        payments: {
          include: {
            paymentMethod: {
              select: { name: true, category: true },
            },
          },
        },
      },
    });

    if (!sale) return null;

    return {
      id: sale.id,
      clientId: sale.clientId,
      clientNameSnapshot: sale.clientNameSnapshot,
      clientIdentificationTypeSnapshot: sale.clientIdentificationTypeSnapshot,
      clientIdentificationNumberSnapshot: sale.clientIdentificationNumberSnapshot,
      subtotal: sale.subtotal,
      totalDiscount: sale.totalDiscount,
      totalTax: sale.totalTax,
      totalAmount: sale.totalAmount,
      changeAmount: sale.changeAmount,
      items: sale.items.map((item) => ({
        productCommercialNameSnapshot: item.productCommercialNameSnapshot,
        productInternalCodeSnapshot: item.productInternalCodeSnapshot,
        productGenericNameSnapshot: item.productGenericNameSnapshot,
        productConcentrationSnapshot: item.productConcentrationSnapshot,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        taxAmount: item.taxAmount,
        discountPercentage: item.discountPercentage,
        discountAmount: item.discountAmount,
        discountReason: item.discountReason,
        subtotal: item.subtotal,
        total: item.total,
      })),
      payments: sale.payments.map((p) => ({
        paymentMethodId: p.paymentMethodId,
        amount: p.amount,
        transactionReference: p.transactionReference,
        authorizationCode: p.authorizationCode,
        cardBrand: p.cardBrand,
        cardLastFour: p.cardLastFour,
        paymentMethod: p.paymentMethod
          ? { name: p.paymentMethod.name, category: p.paymentMethod.category }
          : null,
      })),
    };
  }

  private buildInvoiceFullData(
    sale: NonNullable<Awaited<ReturnType<InvoiceServiceImpl['buildSaleSnapshot']>>>,
    invoiceNumber: string,
    contingencyNumber: string | null,
    relatedInvoiceNumber: string | null,
  ): InvoiceFullData {
    const now = new Date().toISOString();

    const lineItems: InvoiceLineItem[] = sale.items.map((item) => ({
      productId: '',
      internalCode: item.productInternalCodeSnapshot,
      commercialName: item.productCommercialNameSnapshot,
      genericName: item.productGenericNameSnapshot,
      concentration: item.productConcentrationSnapshot,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toString(),
      discountPercentage: item.discountPercentage.toString(),
      discountAmount: item.discountAmount.toString(),
      discountReason: item.discountReason,
      taxRate: item.taxRate.toString(),
      taxAmount: item.taxAmount.toString(),
      subtotal: item.subtotal.toString(),
      total: item.total.toString(),
    }));

    // Build tax summaries grouped by rate
    const taxMap = new Map<string, { rate: string; taxableAmount: number; taxAmount: number }>();
    for (const item of sale.items) {
      const key = `IVA-${item.taxRate.toString()}`;
      const existing = taxMap.get(key) ?? {
        rate: item.taxRate.toString(),
        taxableAmount: 0,
        taxAmount: 0,
      };
      existing.taxableAmount += Number(item.subtotal);
      existing.taxAmount += Number(item.taxAmount);
      taxMap.set(key, existing);
    }

    const taxSummaries: InvoiceTaxSummary[] = Array.from(taxMap.entries()).map(
      ([, data]) => ({
        scheme: 'IVA',
        rate: data.rate,
        taxableAmount: data.taxableAmount.toFixed(2),
        taxAmount: data.taxAmount.toFixed(2),
      }),
    );

    const payments: InvoicePayment[] = sale.payments.map((p) => ({
      paymentMethodId: p.paymentMethodId,
      paymentMethodName: p.paymentMethod?.name ?? 'Unknown',
      amount: p.amount.toString(),
      category: p.paymentMethod?.category ?? 'OTHER',
      transactionReference: p.transactionReference,
      authorizationCode: p.authorizationCode,
      cardBrand: p.cardBrand,
      cardLastFour: p.cardLastFour,
    }));

    const buyer: InvoiceBuyer = {
      identificationType: sale.clientIdentificationTypeSnapshot ?? null,
      identificationNumber: sale.clientIdentificationNumberSnapshot ?? null,
      name: sale.clientNameSnapshot ?? 'CONSUMIDOR FINAL',
      email: null,
      phone: null,
      address: null,
    };

    const seller: InvoiceSeller = {
      nit: '',
      name: '',
      address: null,
      phone: null,
      resolutionNumber: null,
      resolutionDate: null,
      resolutionPrefix: 'FE',
    };

    return {
      invoiceType: 'ELECTRONIC_INVOICE',
      invoiceNumber,
      contingencyNumber,
      relatedInvoiceNumber,
      seller,
      buyer,
      lineItems,
      taxSummaries,
      payments,
      subtotal: sale.subtotal.toString(),
      totalDiscount: sale.totalDiscount.toString(),
      totalTax: sale.totalTax.toString(),
      totalAmount: sale.totalAmount.toString(),
      changeAmount: sale.changeAmount.toString(),
      issuedAt: now,
      currency: 'COP',
      prescriptionNumber: null,
      workstationCode: this.workstationId.slice(0, 8),
    };
  }

  private buildCreditNoteFullData(
    creditNoteInput: CreditNoteInput,
    invoiceNumber: string,
    originalInvoiceNumber: string | null,
  ): InvoiceFullData {
    const now = new Date().toISOString();

    const lineItems: InvoiceLineItem[] = creditNoteInput.items.map((item) => ({
      productId: '',
      internalCode: '',
      commercialName: '',
      genericName: null,
      concentration: null,
      quantity: item.quantity,
      unitPrice: item.unitPriceAtReturn,
      discountPercentage: '0.00',
      discountAmount: '0.00',
      discountReason: null,
      taxRate: '0.00',
      taxAmount: item.taxAmount,
      subtotal: (Number(item.unitPriceAtReturn) * item.quantity).toFixed(2),
      total: item.totalAmount,
    }));

    const taxSummaries: InvoiceTaxSummary[] = [
      {
        scheme: 'IVA',
        rate: '0.00',
        taxableAmount: creditNoteInput.subtotalReturned,
        taxAmount: creditNoteInput.taxReturned,
      },
    ];

    return {
      invoiceType: 'CREDIT_NOTE',
      invoiceNumber,
      contingencyNumber: null,
      relatedInvoiceNumber: originalInvoiceNumber,
      seller: {
        nit: '',
        name: '',
        address: null,
        phone: null,
        resolutionNumber: null,
        resolutionDate: null,
        resolutionPrefix: 'FE',
      },
      buyer: {
        identificationType: null,
        identificationNumber: null,
        name: 'CONSUMIDOR FINAL',
        email: null,
        phone: null,
        address: null,
      },
      lineItems,
      taxSummaries,
      payments: [],
      subtotal: creditNoteInput.subtotalReturned,
      totalDiscount: '0.00',
      totalTax: creditNoteInput.taxReturned,
      totalAmount: creditNoteInput.refundAmount,
      changeAmount: '0.00',
      issuedAt: now,
      currency: 'COP',
      prescriptionNumber: null,
      workstationCode: this.workstationId.slice(0, 8),
    };
  }

  private buildCufeData(fullData: InvoiceFullData) {
    return {
      sellerNit: fullData.seller.nit || '000000000',
      invoiceType: fullData.invoiceType,
      invoiceNumber: fullData.invoiceNumber,
      issuedAt: fullData.issuedAt,
      subtotal: fullData.subtotal,
      totalTax: fullData.totalTax,
      totalAmount: fullData.totalAmount,
      buyerIdentification: fullData.buyer.identificationNumber ?? '000000000',
      buyerName: fullData.buyer.name,
      taxSummaries: fullData.taxSummaries,
    };
  }

  private async buildAndInsertSyncQueueEntry(
    tx: Prisma.TransactionClient,
    invoice: { id: string },
    fullData: InvoiceFullData,
  ): Promise<void> {
    const payload = {
      invoiceId: invoice.id,
      invoiceNumber: fullData.invoiceNumber,
      contingencyNumber: fullData.contingencyNumber,
      saleId: '', // resolved at queue time from the invoice record
      provisionalCufe: '',
      fullInvoiceData: fullData,
      workstationId: this.workstationId,
    };

    const payloadStr = JSON.stringify(payload);
    const payloadBytes = new TextEncoder().encode(payloadStr);
    const payloadHash = await this.computeHash(payloadStr);
    const operationUuid = globalThis.crypto.randomUUID();

    const latestSeq = await tx.syncQueue.findFirst({
      where: { sourceWorkstationId: this.workstationId },
      orderBy: { clientSequence: 'desc' },
      select: { clientSequence: true },
    });
    const clientSequence = latestSeq ? latestSeq.clientSequence + 1n : 1n;

    await tx.syncQueue.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        operationUuid,
        operationType: 'INVOICE_TRANSMISSION',
        payload: payloadStr,
        payloadHash,
        payloadSize: payloadBytes.length,
        versionSchema: 1,
        status: 'PENDING',
        retryCount: 0,
        sourceWorkstationId: this.workstationId,
        sourceCreatedAt: new Date(),
        clientSequence,
      },
    });
  }

  private async computeHash(payload: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}
