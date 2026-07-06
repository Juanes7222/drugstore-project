import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { QueryFiscalDocumentsDto } from '../dto/query-fiscal-documents.dto';
import { DuplicateFiscalDocumentException } from '../exceptions/duplicate-fiscal-document.exception';
import { NoActiveResolutionForWorkstationException } from '../exceptions/no-active-resolution-for-workstation.exception';
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

  // ── New methods for Phase 25 ───────────────────────────────────

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

    const allocation = await this.findActiveAllocation(tx, saleId, documentType);
    const nextConsecutive = await this.allocateNextConsecutive(tx, allocation);
    const resolution = allocation.resolution;

    const issuerConfig = await (this.prisma.fiscalIssuerConfig as any).findFirst();
    const docId = crypto.randomUUID();

    return tx.fiscalDocument.create({
      data: {
        id: docId,
        documentType,
        consecutiveNumber: nextConsecutive,
        fullNumber: `${resolution.prefix}${nextConsecutive}`,
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

  /** Finds an active, non-exhausted allocation for the sale's workstation. */
  private async findActiveAllocation(
    tx: any,
    saleId: string,
    documentType: string,
  ): Promise<any> {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      select: { workstationId: true },
    });

    const allocation = await (tx.fiscalResolutionAllocation as any).findFirst({
      where: {
        workstationId: sale.workstationId,
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
        sale.workstationId,
        documentType,
      );
    }
    return allocation;
  }

  /**
   * Atomically increments currentConsecutive on the allocation row.
   * PostgreSQL's UPDATE row lock serialises concurrent allocations, so
   * two transactions racing on the same allocation never see the same value.
   * Throws ResolutionExhaustedException if the new value exceeds rangeTo.
   */
  private async allocateNextConsecutive(
    tx: any,
    allocation: any,
  ): Promise<number> {
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
    return updated.currentConsecutive;
  }
}
