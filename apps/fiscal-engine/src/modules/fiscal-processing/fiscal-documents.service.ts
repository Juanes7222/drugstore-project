import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CufeCalculator } from './builders/cufe.calculator';
import { UblInvoiceBuilder } from './builders/ubl-invoice.builder';
import { FiscalDocumentGenerationFailedException } from './exceptions/fiscal-document-generation-failed.exception';

/**
 * Orchestrates the generation of a fiscal document's UBL XML and CUFE.
 * Called by the BullMQ processor once per job.
 */
@Injectable()
export class FiscalDocumentsService {
  private readonly logger = new Logger(FiscalDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cufeCalculator: CufeCalculator,
    private readonly ublInvoiceBuilder: UblInvoiceBuilder,
  ) {}

  /**
   * Loads the pending fiscal document, fetches all related data,
   * computes the CUFE, builds the UBL XML, and persists the result.
   * Throws FiscalDocumentGenerationFailedException on any failure.
   */
  async generate(fiscalDocumentId: string): Promise<void> {
    const doc = await this.prisma.fiscalDocument.findUnique({
      where: { id: fiscalDocumentId },
    });

    if (!doc) {
      throw new FiscalDocumentGenerationFailedException(
        fiscalDocumentId,
        'Document not found',
      );
    }

    const sale = await this.loadSale(doc.saleId, fiscalDocumentId);
    const saleItems = await this.loadSaleItems(doc.saleId, fiscalDocumentId);
    const issuerConfig = await this.loadIssuerConfig(fiscalDocumentId);
    const customer = await this.loadCustomer(sale, fiscalDocumentId);

    const issueDateStr = this.formatIssueDate(doc.issueDate);

    const cufe = this.cufeCalculator.computeCufe({
      documentType: doc.documentType,
      fullNumber: doc.fullNumber,
      issueDate: issueDateStr,
      issuerNit: issuerConfig.nit,
      issuerVerificationDigit: issuerConfig.verificationDigit,
      subtotal: this.toDecStr(sale.subtotal),
      totalTax: this.toDecStr(sale.totalTax),
      totalAmount: this.toDecStr(sale.totalAmount),
      softwareId: issuerConfig.softwareId,
    });

    const xml = this.ublInvoiceBuilder.build({
      documentType: doc.documentType,
      fullNumber: doc.fullNumber,
      issueDate: issueDateStr,
      issuerConfig,
      customerParty: customer,
      sale,
      saleItems,
      softwareId: issuerConfig.softwareId,
    });

    await this.persistGeneratedDocument(
      fiscalDocumentId,
      cufe,
      xml,
      sale,
      customer,
    );

    this.logger.log(`Generated fiscal document ${doc.fullNumber} (${fiscalDocumentId})`);
  }

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

  private async loadIssuerConfig(fiscalDocumentId: string): Promise<any> {
    const config = await (this.prisma.fiscalIssuerConfig as any).findFirst();
    if (!config) {
      throw new FiscalDocumentGenerationFailedException(
        fiscalDocumentId,
        'No fiscal issuer configuration found',
      );
    }
    return config;
  }

  private async loadCustomer(sale: any, _fiscalDocumentId: string): Promise<any> {
    if (!sale.clientId) return null;
    return this.prisma.client.findUnique({
      where: { id: sale.clientId },
    });
  }

  private formatIssueDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private toDecStr(value: any): string {
    if (value === null || value === undefined) return '0.00';
    const num = typeof value.toNumber === 'function' ? value.toNumber() : Number(value);
    if (isNaN(num)) return '0.00';
    return num.toFixed(2);
  }

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
