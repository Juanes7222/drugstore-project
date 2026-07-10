import { Injectable, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { QueryFiscalDocumentsDto } from '../dto/query-fiscal-documents.dto';
import { DocumentNotRetryableException } from '../exceptions/document-not-retryable.exception';
import { DuplicateFiscalDocumentException } from '../exceptions/duplicate-fiscal-document.exception';
import { NoActiveResolutionForWorkstationException } from '../exceptions/no-active-resolution-for-workstation.exception';
import { NoValidatedInvoiceForCreditNoteException } from '../exceptions/no-validated-invoice-for-credit-note.exception';
import { ResolutionExhaustedException } from '../exceptions/resolution-exhausted.exception';

/** Placeholder CUFE used before the actual cryptographic hash is computed. */
const PLACEHOLDER_CUFE_PREFIX = 'PENDING_';

@Injectable()
export class FiscalDocumentsService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
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

  /**
   * Retries a FiscalDocument based on its current state.
   *
   * For GENERATION_ERROR, SIGNATURE_ERROR, or CONTINGENCY — resets state to
   * PENDING_GENERATION and returns the same document id for re-enqueueing.
   *
   * For REJECTED — creates a brand-new FiscalDocument for the same source
   * (sale, purchase reception, or client return) under a new consecutive
   * number, leaving the rejected one untouched as a historical record.
   *
   * Any other state throws DocumentNotRetryableException.
   *
   * The entire operation runs inside a single prisma.$transaction.
   */
  async retry(
    fiscalDocumentId: string,
    callerWorkstationId: string,
  ): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx: any) => {
      const doc = await tx.fiscalDocument.findUnique({
        where: { id: fiscalDocumentId },
        select: {
          id: true,
          fiscalState: true,
          saleId: true,
          purchaseReceptionId: true,
          clientReturnId: true,
        },
      });

      if (!doc) {
        throw new DocumentNotRetryableException(
          fiscalDocumentId,
          'NOT_FOUND',
        );
      }

      // ── Regulatory assumption ───────────────────────────────────────────
      // GENERATION_ERROR, SIGNATURE_ERROR, and CONTINGENCY are failures that
      // occurred before DIAN evaluated the document's content — either the
      // failure happened before transmission, or the document was issued under
      // contingency numbering and still needs to be reported through — so
      // retrying resends the exact same document under its existing
      // consecutive number.  If the current DIAN technical annex later
      // contradicts this, adjust the branch below.
      switch (doc.fiscalState) {
        case 'GENERATION_ERROR':
        case 'SIGNATURE_ERROR':
        case 'CONTINGENCY': {
          const updated = await tx.fiscalDocument.update({
            where: { id: fiscalDocumentId },
            data: {
              fiscalState: 'PENDING_GENERATION',
              retryCount: { increment: 1 },
              lastRetryAt: new Date(),
            },
          });
          return { id: updated.id };
        }

        // ── Regulatory assumption ─────────────────────────────────────────
        // REJECTED is different: DIAN evaluated the document and refused it,
        // and the general practice is that a rejected number is not reused.
        // The correct remedy is a brand-new document, with a new consecutive
        // number, for the same underlying sale, reception, or return.  If the
        // current DIAN technical annex later contradicts this, adjust the
        // branch below.
        case 'REJECTED': {
          if (doc.saleId) {
            const newDoc = await this.createPendingDocumentForSale({
              saleId: doc.saleId,
              tx,
            });
            return { id: newDoc.id };
          }
          if (doc.purchaseReceptionId) {
            const result =
              await this.createPendingDocumentForPurchaseReception({
                purchaseReceptionId: doc.purchaseReceptionId,
                workstationId: callerWorkstationId,
                tx,
              });
            // result is null when the supplier's identificationType is NIT.
            // A REJECTED SUPPORT_DOCUMENT should not exist for a NIT supplier,
            // but guard against it anyway.
            if (!result) {
              throw new DocumentNotRetryableException(
                fiscalDocumentId,
                doc.fiscalState,
              );
            }
            return result;
          }
          if (doc.clientReturnId) {
            return await this.createPendingDocumentForClientReturn({
              clientReturnId: doc.clientReturnId,
              tx,
            });
          }
          // REJECTED document with no source association — should not occur
          throw new DocumentNotRetryableException(
            fiscalDocumentId,
            doc.fiscalState,
          );
        }

        default:
          throw new DocumentNotRetryableException(
            fiscalDocumentId,
            doc.fiscalState,
          );
      }
    });
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

    const allocation = await tx.fiscalResolutionAllocation.findFirst({
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
   * Always produces an INVOICE — even when the sale has no client, the
   * customer party is populated using DIAN's final-consumer identity
   * (cbc:AdditionalAccountID = "2", PartyIdentification/cbc:ID = 222222222222
   * with @schemeName = "13", RegistrationName = "consumidor final",
   * TaxLevelCode = "R-99-PN"), so every sale invoice can be referenced
   * unambiguously by a credit note later.
   *
   * Must be called inside the sale confirmation transaction.
   */
  async createPendingDocumentForSale(params: {
    saleId: string;
    tx: any;
  }): Promise<any> {
    const { saleId, tx } = params;
    const documentType = 'INVOICE';
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

    const issuerConfig = await this.prisma.fiscalIssuerConfig.findFirst();
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

    const issuerConfig = await this.prisma.fiscalIssuerConfig.findFirst();
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

  // ── Contingency invoice (offline-generated) ─────────────────────────

  /**
   * Creates a FiscalDocument in CONTINGENCY state for an offline-generated
   * invoice received through the sync module (INVOICE_TRANSMISSION).
   *
   * The POS has already confirmed the sale and assigned a provisional
   * invoice number. The server creates a FiscalDocument so the fiscal engine
   * can generate the UBL XML, compute the official CUFE, and transmit to
   * DIAN. The document is created in CONTINGENCY state because it was
   * generated while the POS was operating in offline/contingency mode.
   *
   * Must be called inside a prisma transaction for number allocation safety.
   * After the transaction commits, the caller must enqueue the job via
   * `enqueueGenerationJob(fiscalDocumentId)` — NOT from inside the transaction.
   */
  async createPendingDocumentForContingency(params: {
    saleId: string;
    workstationId: string;
    provisionalCufe: string;
    tx: any;
  }): Promise<{ id: string }> {
    const { saleId, workstationId, provisionalCufe, tx } = params;
    const documentType = 'INVOICE';

    // Check if a FiscalDocument already exists for this sale (idempotency)
    const existing = await tx.fiscalDocument.findFirst({
      where: { saleId, documentType },
      select: { id: true, fiscalState: true },
    });
    if (existing) {
      // If it already exists and is not in a terminal-error state, return it
      if (!['GENERATION_ERROR', 'SIGNATURE_ERROR'].includes(existing.fiscalState)) {
        return { id: existing.id };
      }
      // If in error state, reset for retry
      await tx.fiscalDocument.update({
        where: { id: existing.id },
        data: {
          fiscalState: 'PENDING_GENERATION',
          retryCount: { increment: 1 },
          lastRetryAt: new Date(),
        },
      });
      return { id: existing.id };
    }

    const { allocation, resolution, consecutiveNumber } =
      await this.allocateDocumentNumber({
        tx,
        workstationId,
        documentType,
      });

    const issuerConfig = await this.prisma.fiscalIssuerConfig.findFirst();
    const docId = crypto.randomUUID();

    await tx.fiscalDocument.create({
      data: {
        id: docId,
        documentType,
        consecutiveNumber,
        fullNumber: `${resolution.prefix}${consecutiveNumber}`,
        issueDate: new Date(),
        cufeCude: provisionalCufe,
        fiscalState: 'CONTINGENCY',
        contingencyReason: 'Offline contingency invoicing — generated by POS while disconnected from server',
        issuerNitSnapshot: issuerConfig?.nit ?? '',
        subtotal: 0,
        totalTax: 0,
        totalAmount: 0,
        saleId,
        resolutionId: resolution.id,
        allocationId: allocation.id,
      },
    });

    return { id: docId };
  }

  // ── New methods for Phase 29 (ClientReturn CREDIT_NOTE) ─────────

  /**
   * Creates a FiscalDocument (CREDIT_NOTE) in PENDING_GENERATION for a
   * confirmed client return.
   *
   * Requires the sale to have a FiscalDocument with documentType INVOICE
   * and fiscalState VALIDATED — a credit note is only meaningful against a
   * validated electronic invoice.  Every sale now always produces an INVOICE
   * (even when no client is registered), so the check resolves cleanly.
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

    const issuerConfig = await this.prisma.fiscalIssuerConfig.findFirst();
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

  /**
   * Throws DuplicateFiscalDocumentException if a non-terminal FiscalDocument
   * already exists for the given (saleId, documentType) pair.
   *
   * A prior document in REJECTED or ANNULLED does NOT count as blocking —
   * those are terminal, non-competing states that the retry flow needs to
   * create past.
   *
   * ── Regulatory assumption ──
   * If the DIAN technical annex later mandates that REJECTED numbers are
   * reusable (i.e. the same consecutive number can be retried after fixing
   * the content), this whole assertion would need to change from "skip
   * terminal states" to "only block on non-terminal states" — the logic is
   * the same, but the rationale would be different.
   */
  private async assertNoDuplicateDocument(
    tx: any,
    saleId: string,
    documentType: string,
  ): Promise<void> {
    const existing = await tx.fiscalDocument.findFirst({
      where: {
        saleId,
        documentType,
        fiscalState: { notIn: ['REJECTED', 'ANNULLED'] },
      },
    });
    if (existing) {
      throw new DuplicateFiscalDocumentException(saleId, documentType);
    }
  }

  /**
   * Throws DuplicateFiscalDocumentException if a non-terminal FiscalDocument
   * already exists for the given (purchaseReceptionId, documentType) pair.
   *
   * See assertNoDuplicateDocument for the regulatory assumption behind
   * excluding REJECTED and ANNULLED from the conflict check.
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
      where: {
        purchaseReceptionId,
        documentType,
        fiscalState: { notIn: ['REJECTED', 'ANNULLED'] },
      },
    });
    if (existing) {
      throw new DuplicateFiscalDocumentException(
        purchaseReceptionId,
        documentType,
      );
    }
  }

  /**
   * Throws DuplicateFiscalDocumentException if a non-terminal FiscalDocument
   * already exists for the given (clientReturnId, documentType) pair.
   *
   * See assertNoDuplicateDocument for the regulatory assumption behind
   * excluding REJECTED and ANNULLED from the conflict check.
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
      where: {
        clientReturnId,
        documentType,
        fiscalState: { notIn: ['REJECTED', 'ANNULLED'] },
      },
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
