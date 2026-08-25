import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CufeCalculator } from './builders/cufe.calculator';
import { UblInvoiceBuilder } from './builders/ubl-invoice.builder';
import { FiscalDocumentGenerationFailedException } from './exceptions/fiscal-document-generation-failed.exception';
import type { FiscalTransmissionPort } from './ports/fiscal-transmission.port';
import { FISCAL_TRANSMISSION_PORT } from './ports/fiscal-transmission.port';
import type { SecretReaderPort } from './ports/secret-reader.port';
import { SECRET_READER_PORT } from './ports/secret-reader.port';
import { TransmissionRouteResolver } from './transmission-route.resolver';

/**
 * Orchestrates the generation of a fiscal document's UBL XML and CUFE.
 * Called by the BullMQ processor once per job.
 *
 * Generates the CUFE using the confirmed DIAN formula (section 11.2 of
 * Technical Annex v1.9), which requires the ClTec fetched live from DIAN's
 * GetNumberingRange web service at generation time rather than from a cache.
 */
@Injectable()
export class FiscalDocumentsService {
  private readonly logger = new Logger(FiscalDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cufeCalculator: CufeCalculator,
    private readonly ublInvoiceBuilder: UblInvoiceBuilder,
    @Inject(FISCAL_TRANSMISSION_PORT)
    private readonly transmission: FiscalTransmissionPort,
    @Inject(SECRET_READER_PORT)
    private readonly secrets: SecretReaderPort,
    private readonly routeResolver: TransmissionRouteResolver,
  ) {}

  /**
   * Loads the pending fiscal document, fetches all related data (sale,
   * resolution, issuer config, customer), resolves secrets, calls DIAN's
   * GetNumberingRange for the ClTec, computes the CUFE, builds the UBL XML,
   * and persists the result.
   *
   * Throws FiscalDocumentGenerationFailedException on any failure.
   */
  async generate(fiscalDocumentId: string): Promise<void> {
    // ── Load the document with its resolution ──
    const doc = await this.prisma.fiscalDocument.findUnique({
      where: { id: fiscalDocumentId },
      include: { resolution: true },
    });

    if (!doc) {
      throw new FiscalDocumentGenerationFailedException(
        fiscalDocumentId,
        'Document not found',
      );
    }

    if (!doc.resolution) {
      throw new FiscalDocumentGenerationFailedException(
        fiscalDocumentId,
        'Document has no associated FiscalResolution',
      );
    }

    // ── Load related domain data ──
    const sale = await this.loadSale(doc.saleId, fiscalDocumentId);
    const saleItems = await this.loadSaleItems(doc.saleId ?? '', fiscalDocumentId);
    const issuerConfig = await this.loadIssuerConfig(doc.subscriptionId, fiscalDocumentId);
    const customer = await this.loadCustomer(sale, fiscalDocumentId);

    const issueDateStr = this.formatIssueDate(doc.issueDate);
    const issueTimeStr = this.formatIssueTime(doc.issueDate);

    // ── Resolve secrets and fetch ClTec from DIAN ──
    const techConfig = await this.loadTechProviderConfig(doc.subscriptionId, fiscalDocumentId);

    // Same party as transmission: the plan's billingMethod picks between our
    // server-side credential (PROVIDER) and the tenant's certificate.
    const route = await this.routeResolver.resolve(doc.subscriptionId);
    if (route === 'PROVIDER' && !techConfig.credentialReference) {
      throw new FiscalDocumentGenerationFailedException(
        fiscalDocumentId,
        'plan uses provider transmission but TechProviderConfig has no credentialReference configured server-side',
      );
    }

    const secretData = await this.secrets.readSecret(
      doc.subscriptionId,
      route === 'PROVIDER' ? techConfig.credentialReference ?? '' : '',
    );

    const clTec = await this.fetchClTec({
      documentId: fiscalDocumentId,
      resolutionNumber: doc.resolution.resolutionNumber,
      resolutionPrefix: doc.resolution.prefix,
      issuerNit: issuerConfig.nit,
      certificate: secretData.certificate,
      certPassword: secretData.password,
      environment: techConfig.environment,
    });

    // ── Determine customer ID for CUFE NumAdq ──
    // When the sale has no client, use DIAN's documented final-consumer identity
    // (222222222222), matching what the UBL builder inserts into
    // PartyTaxScheme/cbc:CompanyID.
    const customerId =
      customer?.identificationNumber ?? '222222222222';

    // ── Build tax amounts for CUFE in fixed order 01 (IVA), 04 (INC), 03 (ICA) ──
    // An absent tax still contributes its literal code plus "0.00" per the formula.
    const taxAmounts = this.buildCufeTaxAmounts(sale);

    // ── Compute CUFE ──
    const cufe = this.cufeCalculator.computeCufe({
      fullNumber: doc.fullNumber,
      issueDate: issueDateStr,
      issueTime: issueTimeStr,
      subtotal: sale.subtotal?.toString() ?? '0',
      taxAmounts,
      totalAmount: sale.totalAmount?.toString() ?? '0',
      issuerNit: issuerConfig.nit,
      customerId,
      clTec,
      environment: techConfig.environment,
    });

    // ── Build UBL XML ──
    const xml = this.ublInvoiceBuilder.build({
      documentType: doc.documentType,
      fullNumber: doc.fullNumber,
      issueDate: issueDateStr,
      issueTime: issueTimeStr,
      issuerConfig,
      customerParty: customer,
      sale: {
        subtotal: sale.subtotal,
        totalTax: sale.totalTax,
        totalAmount: sale.totalAmount,
        totalDiscount: sale.totalDiscount,
        taxAmounts: taxAmounts.map((t) => ({ code: t.code, amount: t.amount })),
      },
      saleItems,
      softwareId: issuerConfig.softwareId ?? '',
      softwareSecurityCode: secretData.softwareSecurityCode,
      resolutionAuthNumber: doc.resolution.resolutionNumber,
      resolutionPeriodStart: this.formatIssueDate(doc.resolution.validFrom),
      resolutionPeriodEnd: this.formatIssueDate(doc.resolution.validTo),
      resolutionPrefix: doc.resolution.prefix,
      resolutionRangeFrom: doc.resolution.rangeFrom,
      resolutionRangeTo: doc.resolution.rangeTo,
      clTec,
      environment: techConfig.environment,
    });

    // ── Persist ──
    await this.persistGeneratedDocument(fiscalDocumentId, cufe, xml, sale, customer);

    this.logger.log(
      `Generated fiscal document ${doc.fullNumber} (${fiscalDocumentId})`,
    );
  }

  // ── Data loaders ──────────────────────────────────────────────────────

  private async loadSale(
    saleId: string | null,
    fiscalDocumentId: string,
  ): Promise<any> {
    if (!saleId) {
      throw new FiscalDocumentGenerationFailedException(
        fiscalDocumentId,
        'Fiscal document has no associated sale',
      );
    }
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
    });
    if (!sale) {
      throw new FiscalDocumentGenerationFailedException(
        fiscalDocumentId,
        `Sale ${saleId} not found`,
      );
    }
    return sale;
  }

  private async loadSaleItems(
    saleId: string,
    fiscalDocumentId: string,
  ): Promise<any[]> {
    const items = await this.prisma.saleItem.findMany({
      where: { saleId },
    });
    if (!items || items.length === 0) {
      throw new FiscalDocumentGenerationFailedException(
        fiscalDocumentId,
        `Sale ${saleId} has no items`,
      );
    }
    return items;
  }

  // Scoped by subscription, same criterion as NumberingRangeProcessor: an
  // unscoped findFirst could return another tenant's fiscal identity.
  private async loadIssuerConfig(
    subscriptionId: string,
    fiscalDocumentId: string,
  ): Promise<any> {
    const config = await this.prisma.fiscalIssuerConfig.findFirst({
      where: { subscriptionId },
    });
    if (!config) {
      throw new FiscalDocumentGenerationFailedException(
        fiscalDocumentId,
        `No FiscalIssuerConfig found for subscription ${subscriptionId}`,
      );
    }
    return config;
  }

  private async loadCustomer(
    sale: any,
    _fiscalDocumentId: string,
  ): Promise<any> {
    if (!sale.clientId) return null;
    return this.prisma.client.findUnique({
      where: { id: sale.clientId },
    });
  }

  private async loadTechProviderConfig(
    subscriptionId: string,
    fiscalDocumentId: string,
  ): Promise<any> {
    const config = await this.prisma.techProviderConfig.findFirst({
      where: { subscriptionId },
    });
    if (!config) {
      throw new FiscalDocumentGenerationFailedException(
        fiscalDocumentId,
        'No TechProviderConfig found - cannot authenticate with DIAN for ClTec lookup',
      );
    }
    return config;
  }

  /**
   * Fetches the live ClTec for the document's resolution (CUFE formula,
   * annex §11.2) by querying every range DIAN has registered for the issuer
   * NIT (Annex §7.15) and selecting the one backing this document — matching
   * on resolution number AND prefix, since DIAN can hold several ranges per
   * taxpayer.
   *
   * Both request fields carry the tenant NIT: accountCode is the invoicing
   * party, accountCodeT the software owner, identical under own-software
   * mode; a provider-owned-software mode would need the provider NIT here
   * once TechProviderConfig carries one.
   */
  private async fetchClTec(options: {
    documentId: string;
    resolutionNumber: string;
    resolutionPrefix: string;
    issuerNit: string;
    certificate: Buffer;
    certPassword: string;
    environment: string;
  }): Promise<string> {
    const ranges = await this.transmission.fetchNumberingRanges(
      options.certificate,
      options.certPassword,
      options.environment,
      // Both request fields are the NIT without verification digit.
      options.issuerNit,
      options.issuerNit,
    );

    const match = ranges.find(
      (range) =>
        range.resolutionNumber === options.resolutionNumber &&
        range.prefix === options.resolutionPrefix,
    );
    if (!match || !match.technicalKey) {
      throw new FiscalDocumentGenerationFailedException(
        options.documentId,
        'DIAN returned no numbering range with a technical key matching ' +
          `resolution ${options.resolutionNumber} (${options.resolutionPrefix})`,
      );
    }
    return match.technicalKey;
  }

  // ── Formatting helpers ────────────────────────────────────────────────

  private formatIssueDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Formats a Date to the DIAN-required time format with GMT offset:
   * HH:mm:ss±HH:mm (e.g. "10:53:10-05:00").
   */
  private formatIssueTime(date: Date): string {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const offsetMin = date.getTimezoneOffset();
    const absOffset = Math.abs(offsetMin);
    const offsetHours = Math.floor(absOffset / 60);
    const offsetMins = absOffset % 60;
    const sign = offsetMin <= 0 ? '+' : '-';
    return `${hh}:${mm}:${ss}${sign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;
  }

  /**
   * Builds the tax-amount breakdown for the CUFE formula.
   * Currently treats the entire totalTax as IVA (code 01); INC (04) and
   * ICA (03) default to "0". If the schema later supports per-item tax-type
   * classification (e.g. SaleItem.taxType), refine this method to aggregate
   * by tax code. The CUFE formula always concatenates codes 01, 04, 03 in
   * that fixed order regardless of presence.
   */
  private buildCufeTaxAmounts(sale: any): { code: string; amount: string }[] {
    return [
      { code: '01', amount: sale.totalTax?.toString() ?? '0' },
      { code: '04', amount: '0' },
      { code: '03', amount: '0' },
    ];
  }

  // ── Persistence ───────────────────────────────────────────────────────

  private async persistGeneratedDocument(
    fiscalDocumentId: string,
    cufe: string,
    xml: string,
    sale: any,
    customer: any,
  ): Promise<void> {
    const updateData: Record<string, any> = {
      cufeCude: cufe,
      xmlPayload: xml,
      fiscalState: 'GENERATED',
      subtotal: sale.subtotal,
      totalTax: sale.totalTax,
      totalAmount: sale.totalAmount,
      receiverNitSnapshot: customer?.identificationNumber ?? null,
      receiverNameSnapshot: customer?.fullName ?? null,
      receiverType: customer?.identificationType ?? null,
    };

    await this.prisma.fiscalDocument.update({
      where: { id: fiscalDocumentId },
      data: updateData,
    });
  }
}
