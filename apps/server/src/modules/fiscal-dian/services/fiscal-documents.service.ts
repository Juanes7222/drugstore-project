import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { QueryFiscalDocumentsDto } from '../dto/query-fiscal-documents.dto';
import { DuplicateFiscalDocumentException } from '../exceptions/duplicate-fiscal-document.exception';
import { NoActiveResolutionForWorkstationException } from '../exceptions/no-active-resolution-for-workstation.exception';
import { NoValidatedInvoiceForCreditNoteException } from '../exceptions/no-validated-invoice-for-credit-note.exception';
import { ResolutionExhaustedException } from '../exceptions/resolution-exhausted.exception';

/** Placeholder CUFE used before the actual cryptographic hash is computed. */
const PLACEHOLDER_CUFE_PREFIX = 'PENDING_';

@Injectable()
export class FiscalDocumentsService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('fiscal-documents') private queue: Queue,
  ) {}

  async findAll(query: QueryFiscalDocumentsDto): Promise<any> {
    throw new NotImplementedForPhaseException('fiscal-dian', 'findAll');
  }

  async findById(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('fiscal-dian', 'findById');
  }

  async getXmlPayload(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('fiscal-dian', 'getXmlPayload');
  }

  async retryDocument(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('fiscal-dian', 'retryDocument');
  }

  // ── Shared numbering helper (extracted from createPendingDocumentForSale) ──

  /**
   * Locates an active, non-exhausted FiscalResolutionAllocation for the given
   * workstation and document type, then atomically increments the current
   * consecutive number under PostgreSQL row-level locking.  Returns the
   * allocation, its parent resolution, and the newly allocated consecutive.
   *
   * Throws NoActiveResolutionForWorkstationException or
   * ResolutionExhaustedException.
   *
   * Shared by createPendingDocumentForSale (via the sale's own workstationId)
   * and createPendingDocumentForPurchaseReception (via the caller-supplied
   * workstationId).
   */
  private async allocateDocumentNumber(params: {
    tx: any;
    workstationId: string;
    documentType: string;
  }): Promise<{ allocation: any; resolution: any; consecutiveNumber: number }> {
    const { tx, workstationId, documentType } = params;

    const allocation = await (tx.fiscalResolutionAllocation as any).findFirst({
      where: {
        workstationId,
        exhaustedAt: null,
        resolution: {
          state: 'ACTIVE',
          documentType,
        },
      },
      include: { resolution: true },
    });

    if (!allocation) {
      throw new NoActiveResolutionForWorkstationException(
        workstationId,
        documentType,
      );
    }

    const updated = await tx.fiscalResolutionAllocation.update({
      where: { id: allocation.id },
      data: { currentConsecutive: { increment: 1 } },
    });

    if (updated.currentConsecutive > updated.rangeTo) {
      await tx.fiscalResolutionAllocation.update({
        where: { id: allocation.id },
        data: { exhaustedAt: new Date() },
      });
      throw new ResolutionExhaustedException(allocation.id);
    }

    return {
      allocation,
      resolution: allocation.resolution,
      consecutiveNumber: updated.currentConsecutive,
    };
  }

  // ── Refactored: now calls allocateDocumentNumber instead of the two
  //    separate private methods that are no longer needed. ──

  /**
   * Creates a FiscalDocument in PENDING_GENERATION for a confirmed sale.
   * Must be called inside the sale confirmation transaction.
   * documentType is INVOICE when the sale has a clientId, POS_TICKET otherwise —
   * a deliberate simplification; DIAN's real invoice vs. ticket distinction
   * involves more than just client presence.
   */
  async createPendingDocumentForSale(params: {
    saleId: string;
    tx: any;
  }): Promise<any> {
    const { saleId, tx } = params;
    const documentType = await this.resolveDocumentType(tx, saleId);
    await this.assertNoDuplicateDocument(tx, saleId, documentType);

    // sale must exist — we are inside the confirmation transaction
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      select: { workstationId: true },
    });
    const { allocation, resolution, consecutiveNumber } =
      await this.allocateDocumentNumber({
        tx,
        workstationId: sale.workstationId,
        documentType,
      });

    const issuerConfig = await (
      this.prisma.fiscalIssuerConfig as any
    ).findFirst();
    const docId = crypto.randomUUID();

    return tx.fiscalDocument.create({
      data: {
        id: docId,
        documentType,
        consecutiveNumber,
        fullNumber: `${resolution.prefix}${consecutiveNumber}`,
        issueDate: new Date(),
        cufeCude: `${PLACEHOLDER_CUFE_PREFIX}${docId}`,
        fiscalState: 'PENDING_GENERATION',
        issuerNitSnapshot: issuerConfig?.nit ?? '',
        subtotal: 0,
        totalTax: 0,
        totalAmount: 0,
        saleId,
        resolutionId: resolution.id,
        allocationId: allocation.id,
      },
    });
  }

  /**
   * Creates a FiscalDocument (SUPPORT_DOCUMENT) in PENDING_GENERATION for a
   * confirmed purchase reception, but only when the supplier's
   * identificationType is not NIT — a NIT-identified supplier is presumed to
   * issue its own electronic invoice, making the support document unnecessary.
   *
   * Must be called inside the purchase reception confirmation transaction.
   * Returns the created document id, or null if no document was needed.
   *
   * @see createPendingDocumentForSale — parallel flow for sales.
   *
   * ── Heuristic notice ──
   * This check uses `identificationType !== NIT` as a proxy for "supplier not
   * obligated to invoice electronically".  A future schema change that adds
   * an explicit `Supplier.isElectronicInvoicer` boolean would replace this
   * approximation outright — not refine it further.
   *
   * ── Operational note ──
   * PurchaseReception has no workstationId of its own (receiving stock is not
   * a per-cashier operation), so the caller must supply the confirming user's
   * session workstationId.  That workstation must have an active
   * SUPPORT_DOCUMENT allocation set up during fiscal configuration — most
   * naturally a dedicated back-office workstation, not a POS terminal.
   */
  async createPendingDocumentForPurchaseReception(params: {
    purchaseReceptionId: string;
    workstationId: string;
    tx: any;
  }): Promise<{ id: string } | null> {
    const { purchaseReceptionId, workstationId, tx } = params;

    // The reception was just confirmed in the same transaction, so it exists.
    const reception = await tx.purchaseReception.findUnique({
      where: { id: purchaseReceptionId },
      select: {
        supplier: {
          select: { identificationType: true },
        },
      },
    });

    // NIT-identified suppliers are presumed to issue their own electronic
    // invoices, so no SUPPORT_DOCUMENT is needed.
    if (reception?.supplier?.identificationType === 'NIT') {
      return null;
    }

    const documentType = 'SUPPORT_DOCUMENT';
    await this.assertNoDuplicateDocumentForReception(
      tx,
      purchaseReceptionId,
      documentType,
    );

    const { allocation, resolution, consecutiveNumber } =
      await this.allocateDocumentNumber({
        tx,
        workstationId,
        documentType,
      });

    const issuerConfig = await (
      this.prisma.fiscalIssuerConfig as any
    ).findFirst();
    const docId = crypto.randomUUID();

    const doc = await tx.fiscalDocument.create({
      data: {
        id: docId,
        documentType,
        consecutiveNumber,
        fullNumber: `${resolution.prefix}${consecutiveNumber}`,
        issueDate: new Date(),
        cufeCude: `${PLACEHOLDER_CUFE_PREFIX}${docId}`,
        fiscalState: 'PENDING_GENERATION',
        issuerNitSnapshot: issuerConfig?.nit ?? '',
        subtotal: 0,
        totalTax: 0,
        totalAmount: 0,
        purchaseReceptionId,
        resolutionId: resolution.id,
        allocationId: allocation.id,
      },
    });

    return { id: doc.id };
  }

  // ── New methods for Phase 29 (ClientReturn CREDIT_NOTE) ─────────

  /**
   * Creates a FiscalDocument (CREDIT_NOTE) in PENDING_GENERATION for a
   * confirmed client return.
   *
   * Loads the return's Sale and that sale's FiscalDocuments, and requires
   * one with documentType INVOICE and fiscalState VALIDATED — a credit note
   * is only meaningful against a validated electronic invoice.  If the sale
   * was fiscally issued as a POS_TICKET or its INVOICE was never validated,
   * throws NoValidatedInvoiceForCreditNoteException.
   *
   * Must be called inside the client return confirmation transaction.
   * Sets referenceDocumentId to the original invoice's id, and updates
   * ClientReturn.creditNoteId to the new document's id, both atomically in
   * the same transaction.
   */
  async createPendingDocumentForClientReturn(params: {
    clientReturnId: string;
    tx: any;
  }): Promise<{ id: string }> {
    const { clientReturnId, tx } = params;

    // Load the return to get its workstationId and the parent sale
    const clientReturn = await tx.clientReturn.findUnique({
      where: { id: clientReturnId },
      select: {
        workstationId: true,
        sale: {
          select: { id: true },
        },
      },
    });

    // Find the original validated INVOICE for this sale
    const invoiceDoc = await tx.fiscalDocument.findFirst({
      where: {
        saleId: clientReturn.sale.id,
        documentType: 'INVOICE',
        fiscalState: 'VALIDATED',
      },
      select: { id: true, documentType: true, fiscalState: true },
    });

    if (!invoiceDoc) {
      // Distinguish "no document at all" from "document exists but is not a
      // validated INVOICE" for a clearer error message.
      const anyDoc = await tx.fiscalDocument.findFirst({
        where: { saleId: clientReturn.sale.id },
        select: { documentType: true, fiscalState: true },
      });
      throw new NoValidatedInvoiceForCreditNoteException(
        clientReturn.sale.id,
        anyDoc?.documentType,
        anyDoc?.fiscalState,
      );
    }

    const documentType = 'CREDIT_NOTE';
    await this.assertNoDuplicateDocumentForClientReturn(
      tx,
      clientReturnId,
      documentType,
    );

    const { allocation, resolution, consecutiveNumber } =
      await this.allocateDocumentNumber({
        tx,
        workstationId: clientReturn.workstationId,
        documentType,
      });

    const issuerConfig = await (
      this.prisma.fiscalIssuerConfig as any
    ).findFirst();
    const docId = crypto.randomUUID();

    const doc = await tx.fiscalDocument.create({
      data: {
        id: docId,
        documentType,
        consecutiveNumber,
        fullNumber: `${resolution.prefix}${consecutiveNumber}`,
        issueDate: new Date(),
        cufeCude: `${PLACEHOLDER_CUFE_PREFIX}${docId}`,
        fiscalState: 'PENDING_GENERATION',
        issuerNitSnapshot: issuerConfig?.nit ?? '',
        subtotal: 0,
        totalTax: 0,
        totalAmount: 0,
        clientReturnId,
        // referenceDocumentId is populated only for CREDIT_NOTE / DEBIT_NOTE;
        // the CHECK constraint is deferred to a future migration.
        referenceDocumentId: invoiceDoc.id,
        resolutionId: resolution.id,
        allocationId: allocation.id,
      },
    });

    // Update the forward-pointing creditNoteId so a return can be read
    // without joining through FiscalDocument.
    await tx.clientReturn.update({
      where: { id: clientReturnId },
      data: { creditNoteId: doc.id },
    });

    return { id: doc.id };
  }

  /**
   * Enqueues a generation job onto the fiscal-documents BullMQ queue.
   * Must be called only after the sale transaction has committed.
   */
  async enqueueGenerationJob(fiscalDocumentId: string): Promise<void> {
    await this.queue.add('generate', { fiscalDocumentId });
  }

  /** Resolves INVOICE vs POS_TICKET based on whether the sale has a client. */
  private async resolveDocumentType(tx: any, saleId: string): Promise<string> {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      select: { clientId: true },
    });
    return sale?.clientId ? 'INVOICE' : 'POS_TICKET';
  }

  /** Throws DuplicateFiscalDocumentException if one already exists. */
  private async assertNoDuplicateDocument(
    tx: any,
    saleId: string,
    documentType: string,
  ): Promise<void> {
    const existing = await tx.fiscalDocument.findFirst({
      where: { saleId, documentType },
    });
    if (existing) {
      throw new DuplicateFiscalDocumentException(saleId, documentType);
    }
  }

  /**
   * Throws DuplicateFiscalDocumentException if a FiscalDocument already
   * exists for the given (purchaseReceptionId, documentType) pair.
   *
   * The exception message references "sale" as the source id for historical
   * reasons; a future refactor should parameterise the label or unify the
   * check for both Sale and PurchaseReception.
   */
  private async assertNoDuplicateDocumentForReception(
    tx: any,
    purchaseReceptionId: string,
    documentType: string,
  ): Promise<void> {
    const existing = await tx.fiscalDocument.findFirst({
      where: { purchaseReceptionId, documentType },
    });
    if (existing) {
      throw new DuplicateFiscalDocumentException(
        purchaseReceptionId,
        documentType,
      );
    }
  }

  /**
   * Throws DuplicateFiscalDocumentException if a FiscalDocument already
   * exists for the given (clientReturnId, documentType) pair.
   *
   * FiscalDocument.clientReturnId has a @unique constraint at the schema
   * level as well, so this check provides a cleaner error message before
   * the database constraint violation surfaces.
   */
  private async assertNoDuplicateDocumentForClientReturn(
    tx: any,
    clientReturnId: string,
    documentType: string,
  ): Promise<void> {
    const existing = await tx.fiscalDocument.findFirst({
      where: { clientReturnId, documentType },
    });
    if (existing) {
      throw new DuplicateFiscalDocumentException(clientReturnId, documentType);
    }
  }

  // ── Removed private methods ──
  // findActiveAllocation  →  replaced by allocateDocumentNumber
  // allocateNextConsecutive →  replaced by allocateDocumentNumber
  //
  // Both were inlined into the single allocateDocumentNumber helper that
  // the two creation methods now share.
}
