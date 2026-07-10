jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { FiscalDocumentsService } from './fiscal-documents.service';
import { DocumentNotRetryableException } from '../exceptions/document-not-retryable.exception';
import { DuplicateFiscalDocumentException } from '../exceptions/duplicate-fiscal-document.exception';
import { NoActiveResolutionForWorkstationException } from '../exceptions/no-active-resolution-for-workstation.exception';
import { NoValidatedInvoiceForCreditNoteException } from '../exceptions/no-validated-invoice-for-credit-note.exception';
import { ResolutionExhaustedException } from '../exceptions/resolution-exhausted.exception';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';

/**
 * Build a minimal FiscalDocument shape for use in retry tests.
 * The service reads only: id, fiscalState, saleId, purchaseReceptionId, clientReturnId.
 */
function buildDoc(overrides: Partial<{
  id: string;
  fiscalState: string;
  saleId: string | null;
  purchaseReceptionId: string | null;
  clientReturnId: string | null;
}> = {}) {
  return {
    id: 'fd-1',
    fiscalState: 'PENDING_GENERATION',
    saleId: null,
    purchaseReceptionId: null,
    clientReturnId: null,
    ...overrides,
  };
}

describe('FiscalDocumentsService', () => {
  let service: FiscalDocumentsService;
  let prisma: DeepMockProxy<PrismaClient>;
  let queue: { add: jest.Mock };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    queue = { add: jest.fn().mockResolvedValue(undefined) };

    // Wire $transaction to execute its callback with the mock itself
    prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));

    service = new FiscalDocumentsService(prisma as any, queue as any);
  });

  // ── Stub methods ──────────────────────────────────────────────────────

  describe('findAll (stub)', () => {
    it('throws NotImplementedForPhaseException', async () => {
      await expect(service.findAll({ page: 1, pageSize: 20 }))
        .rejects.toThrow(NotImplementedForPhaseException);
    });
  });

  describe('findById (stub)', () => {
    it('throws NotImplementedForPhaseException', async () => {
      await expect(service.findById('any-id'))
        .rejects.toThrow(NotImplementedForPhaseException);
    });
  });

  describe('getXmlPayload (stub)', () => {
    it('throws NotImplementedForPhaseException', async () => {
      await expect(service.getXmlPayload('any-id'))
        .rejects.toThrow(NotImplementedForPhaseException);
    });
  });

  // ── retry() ───────────────────────────────────────────────────────────

  describe('retry', () => {
    it('resets to PENDING_GENERATION when fiscalState is GENERATION_ERROR', async () => {
      const doc = buildDoc({ id: 'fd-retry', fiscalState: 'GENERATION_ERROR' });
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(doc);
      (prisma.fiscalDocument.update as jest.Mock).mockResolvedValue({ id: doc.id, fiscalState: 'PENDING_GENERATION' });

      const result = await service.retry('fd-retry', 'ws-1');

      expect(result).toEqual({ id: 'fd-retry' });
      expect(prisma.fiscalDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'fd-retry' },
          data: expect.objectContaining({
            fiscalState: 'PENDING_GENERATION',
            retryCount: { increment: 1 },
            lastRetryAt: expect.any(Date),
          }),
        }),
      );
    });

    it('resets to PENDING_GENERATION when fiscalState is SIGNATURE_ERROR', async () => {
      const doc = buildDoc({ id: 'fd-sig', fiscalState: 'SIGNATURE_ERROR' });
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(doc);
      (prisma.fiscalDocument.update as jest.Mock).mockResolvedValue({ id: doc.id });

      const result = await service.retry('fd-sig', 'ws-1');

      expect(result).toEqual({ id: 'fd-sig' });
    });

    it('resets to PENDING_GENERATION when fiscalState is CONTINGENCY', async () => {
      const doc = buildDoc({ id: 'fd-cont', fiscalState: 'CONTINGENCY' });
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(doc);
      (prisma.fiscalDocument.update as jest.Mock).mockResolvedValue({ id: doc.id });

      const result = await service.retry('fd-cont', 'ws-1');

      expect(result).toEqual({ id: 'fd-cont' });
    });

    it('creates a new document for REJECTED + saleId', async () => {
      const doc = buildDoc({ id: 'fd-rej', fiscalState: 'REJECTED', saleId: 'sale-1' });
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(doc);

      // For createPendingDocumentForSale we need:
      //   assertNoDuplicateDocument: findFirst returns null (no duplicate)
      //   sale.findUnique to get workstationId
      //   allocateDocumentNumber: findFirst allocation, then update allocation
      //   fiscalIssuerConfig.findFirst
      //   fiscalDocument.create
      (prisma.fiscalDocument.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.sale.findUnique as jest.Mock).mockResolvedValue({ workstationId: 'ws-1' });
      (prisma.fiscalResolutionAllocation.findFirst as jest.Mock).mockResolvedValue({
        id: 'alloc-1',
        rangeTo: 100,
        resolution: { id: 'res-1', prefix: 'PRE' },
      });
      (prisma.fiscalResolutionAllocation.update as jest.Mock).mockResolvedValue({
        id: 'alloc-1',
        currentConsecutive: 5,
        rangeTo: 100,
      });
      (prisma.fiscalIssuerConfig.findFirst as jest.Mock).mockResolvedValue({ nit: '900123456' });
      (prisma.fiscalDocument.create as jest.Mock).mockResolvedValue({ id: 'fd-new-1' });

      const result = await service.retry('fd-rej', 'ws-1');

      expect(result).toEqual({ id: 'fd-new-1' });
    });

    it('creates a new SUPPORT_DOCUMENT for REJECTED + purchaseReceptionId (non-NIT)', async () => {
      const doc = buildDoc({ id: 'fd-rej-pr', fiscalState: 'REJECTED', purchaseReceptionId: 'pr-1' });
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(doc);

      // createPendingDocumentForPurchaseReception flow
      (prisma.purchaseReception.findUnique as jest.Mock).mockResolvedValue({
        supplier: { identificationType: 'CC' }, // non-NIT → creates doc
      });
      // Assert no duplicate
      (prisma.fiscalDocument.findFirst as jest.Mock).mockResolvedValue(null);
      // allocateDocumentNumber
      (prisma.fiscalResolutionAllocation.findFirst as jest.Mock).mockResolvedValue({
        id: 'alloc-pr',
        rangeTo: 200,
        resolution: { id: 'res-pr', prefix: 'SUP' },
      });
      (prisma.fiscalResolutionAllocation.update as jest.Mock).mockResolvedValue({
        id: 'alloc-pr',
        currentConsecutive: 10,
        rangeTo: 200,
      });
      (prisma.fiscalIssuerConfig.findFirst as jest.Mock).mockResolvedValue({ nit: '900123456' });
      (prisma.fiscalDocument.create as jest.Mock).mockResolvedValue({ id: 'fd-new-pr' });

      const result = await service.retry('fd-rej-pr', 'ws-1');

      expect(result).toEqual({ id: 'fd-new-pr' });
    });

    it('throws DocumentNotRetryableException for REJECTED + purchaseReceptionId with NIT supplier', async () => {
      const doc = buildDoc({ id: 'fd-nit', fiscalState: 'REJECTED', purchaseReceptionId: 'pr-nit' });
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(doc);

      (prisma.purchaseReception.findUnique as jest.Mock).mockResolvedValue({
        supplier: { identificationType: 'NIT' },
      });

      await expect(service.retry('fd-nit', 'ws-1')).rejects.toThrow(DocumentNotRetryableException);
    });

    it('creates a new CREDIT_NOTE for REJECTED + clientReturnId', async () => {
      const doc = buildDoc({ id: 'fd-rej-cr', fiscalState: 'REJECTED', clientReturnId: 'cr-1' });
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(doc);

      // createPendingDocumentForClientReturn flow
      (prisma.clientReturn.findUnique as jest.Mock).mockResolvedValue({
        workstationId: 'ws-1',
        sale: { id: 'sale-1' },
      });
      // The first findFirst (validated invoice) returns the invoice,
      // the second (assertNoDuplicateDocumentForClientReturn) returns null
      (prisma.fiscalDocument.findFirst as jest.Mock)
        .mockResolvedValueOnce({
          id: 'inv-1',
          documentType: 'INVOICE',
          fiscalState: 'VALIDATED',
        })
        .mockResolvedValueOnce(null);
      // allocation
      (prisma.fiscalResolutionAllocation.findFirst as jest.Mock).mockResolvedValue({
        id: 'alloc-cr',
        rangeTo: 300,
        resolution: { id: 'res-cr', prefix: 'NC' },
      });
      (prisma.fiscalResolutionAllocation.update as jest.Mock).mockResolvedValue({
        id: 'alloc-cr',
        currentConsecutive: 7,
        rangeTo: 300,
      });
      (prisma.fiscalIssuerConfig.findFirst as jest.Mock).mockResolvedValue({ nit: '900123456' });
      (prisma.fiscalDocument.create as jest.Mock).mockResolvedValue({ id: 'fd-new-cr' });
      (prisma.clientReturn.update as jest.Mock).mockResolvedValue({});

      const result = await service.retry('fd-rej-cr', 'ws-1');

      expect(result).toEqual({ id: 'fd-new-cr' });
    });

    it('throws DocumentNotRetryableException when fiscalState is VALIDATED', async () => {
      const doc = buildDoc({ fiscalState: 'VALIDATED' });
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(doc);

      await expect(service.retry('fd-val', 'ws-1')).rejects.toThrow(DocumentNotRetryableException);
    });

    it('throws DocumentNotRetryableException when document is not found', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.retry('fd-missing', 'ws-1')).rejects.toThrow(DocumentNotRetryableException);
    });

    it('throws DocumentNotRetryableException for REJECTED doc with no source association', async () => {
      const doc = buildDoc({ fiscalState: 'REJECTED', saleId: null, purchaseReceptionId: null, clientReturnId: null });
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(doc);

      await expect(service.retry('fd-orphan', 'ws-1')).rejects.toThrow(DocumentNotRetryableException);
    });
  });

  // ── createPendingDocumentForSale ──────────────────────────────────────

  describe('createPendingDocumentForSale', () => {
    beforeEach(() => {
      (prisma.fiscalDocument.findFirst as jest.Mock).mockResolvedValue(null); // no duplicate
      (prisma.sale.findUnique as jest.Mock).mockResolvedValue({ workstationId: 'ws-1' });
      (prisma.fiscalResolutionAllocation.findFirst as jest.Mock).mockResolvedValue({
        id: 'alloc-1',
        rangeTo: 500,
        resolution: { id: 'res-1', prefix: 'PRE' },
      });
      (prisma.fiscalResolutionAllocation.update as jest.Mock).mockResolvedValue({
        id: 'alloc-1',
        currentConsecutive: 42,
        rangeTo: 500,
      });
      (prisma.fiscalIssuerConfig.findFirst as jest.Mock).mockResolvedValue({ nit: '900123456' });
      (prisma.fiscalDocument.create as jest.Mock).mockResolvedValue({ id: 'fd-sale-1' });
    });

    it('creates an INVOICE document inside the transaction', async () => {
      const result = await service.createPendingDocumentForSale({ saleId: 'sale-1', tx: prisma });

      expect(result).toBeDefined();
      expect(result.id).toBe('fd-sale-1');
      expect(prisma.fiscalDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            documentType: 'INVOICE',
            saleId: 'sale-1',
            fiscalState: 'PENDING_GENERATION',
          }),
        }),
      );
    });

    it('throws DuplicateFiscalDocumentException when a non-terminal document already exists', async () => {
      (prisma.fiscalDocument.findFirst as jest.Mock).mockResolvedValue({ id: 'existing', fiscalState: 'PENDING_GENERATION' });

      await expect(
        service.createPendingDocumentForSale({ saleId: 'sale-dup', tx: prisma }),
      ).rejects.toThrow(DuplicateFiscalDocumentException);
    });

    it('throws NoActiveResolutionForWorkstationException when no allocation exists', async () => {
      (prisma.fiscalResolutionAllocation.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createPendingDocumentForSale({ saleId: 'sale-no-alloc', tx: prisma }),
      ).rejects.toThrow(NoActiveResolutionForWorkstationException);
    });

    it('throws ResolutionExhaustedException when allocation range is exhausted', async () => {
      (prisma.fiscalResolutionAllocation.update as jest.Mock).mockResolvedValue({
        id: 'alloc-1',
        currentConsecutive: 501,
        rangeTo: 500,
      });

      await expect(
        service.createPendingDocumentForSale({ saleId: 'sale-exhausted', tx: prisma }),
      ).rejects.toThrow(ResolutionExhaustedException);
    });
  });

  // ── createPendingDocumentForPurchaseReception ─────────────────────────

  describe('createPendingDocumentForPurchaseReception', () => {
    it('returns null when supplier identificationType is NIT', async () => {
      (prisma.purchaseReception.findUnique as jest.Mock).mockResolvedValue({
        supplier: { identificationType: 'NIT' },
      });

      const result = await service.createPendingDocumentForPurchaseReception({
        purchaseReceptionId: 'pr-nit',
        workstationId: 'ws-1',
        tx: prisma,
      });

      expect(result).toBeNull();
    });

    it('creates a SUPPORT_DOCUMENT for non-NIT supplier', async () => {
      (prisma.purchaseReception.findUnique as jest.Mock).mockResolvedValue({
        supplier: { identificationType: 'CC' },
      });
      (prisma.fiscalDocument.findFirst as jest.Mock).mockResolvedValue(null); // no duplicate
      (prisma.fiscalResolutionAllocation.findFirst as jest.Mock).mockResolvedValue({
        id: 'alloc-pr',
        rangeTo: 200,
        resolution: { id: 'res-pr', prefix: 'SUP' },
      });
      (prisma.fiscalResolutionAllocation.update as jest.Mock).mockResolvedValue({
        id: 'alloc-pr',
        currentConsecutive: 15,
        rangeTo: 200,
      });
      (prisma.fiscalIssuerConfig.findFirst as jest.Mock).mockResolvedValue({ nit: '900123456' });
      (prisma.fiscalDocument.create as jest.Mock).mockResolvedValue({ id: 'fd-pr-1' });

      const result = await service.createPendingDocumentForPurchaseReception({
        purchaseReceptionId: 'pr-cc',
        workstationId: 'ws-1',
        tx: prisma,
      });

      expect(result).toEqual({ id: 'fd-pr-1' });
      expect(prisma.fiscalDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            documentType: 'SUPPORT_DOCUMENT',
            purchaseReceptionId: 'pr-cc',
          }),
        }),
      );
    });

    it('throws DuplicateFiscalDocumentException when a non-terminal SUPPORT_DOCUMENT exists', async () => {
      (prisma.purchaseReception.findUnique as jest.Mock).mockResolvedValue({
        supplier: { identificationType: 'CC' },
      });
      (prisma.fiscalDocument.findFirst as jest.Mock).mockResolvedValue({ id: 'existing', fiscalState: 'PENDING_GENERATION' });

      await expect(
        service.createPendingDocumentForPurchaseReception({
          purchaseReceptionId: 'pr-dup',
          workstationId: 'ws-1',
          tx: prisma,
        }),
      ).rejects.toThrow(DuplicateFiscalDocumentException);
    });
  });

  // ── createPendingDocumentForClientReturn ──────────────────────────────

  describe('createPendingDocumentForClientReturn', () => {
    it('creates a CREDIT_NOTE referencing the original validated invoice', async () => {
      (prisma.clientReturn.findUnique as jest.Mock).mockResolvedValue({
        workstationId: 'ws-1',
        sale: { id: 'sale-1' },
      });
      (prisma.fiscalDocument.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 'inv-1', documentType: 'INVOICE', fiscalState: 'VALIDATED' })
        .mockResolvedValueOnce(null); // duplicate check
      (prisma.fiscalResolutionAllocation.findFirst as jest.Mock).mockResolvedValue({
        id: 'alloc-cr',
        rangeTo: 100,
        resolution: { id: 'res-cr', prefix: 'NC' },
      });
      (prisma.fiscalResolutionAllocation.update as jest.Mock).mockResolvedValue({
        id: 'alloc-cr',
        currentConsecutive: 3,
        rangeTo: 100,
      });
      (prisma.fiscalIssuerConfig.findFirst as jest.Mock).mockResolvedValue({ nit: '900123456' });
      (prisma.fiscalDocument.create as jest.Mock).mockResolvedValue({ id: 'fd-cr-1' });
      (prisma.clientReturn.update as jest.Mock).mockResolvedValue({});

      const result = await service.createPendingDocumentForClientReturn({ clientReturnId: 'cr-1', tx: prisma });

      expect(result).toEqual({ id: 'fd-cr-1' });
      expect(prisma.fiscalDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            documentType: 'CREDIT_NOTE',
            clientReturnId: 'cr-1',
            referenceDocumentId: 'inv-1',
          }),
        }),
      );
      expect(prisma.clientReturn.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cr-1' },
          data: { creditNoteId: 'fd-cr-1' },
        }),
      );
    });

    it('throws NoValidatedInvoiceForCreditNoteException when no validated invoice exists', async () => {
      (prisma.clientReturn.findUnique as jest.Mock).mockResolvedValue({
        workstationId: 'ws-1',
        sale: { id: 'sale-1' },
      });
      (prisma.fiscalDocument.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // first call: invoice search — not found
        .mockResolvedValueOnce({ documentType: 'POS_TICKET', fiscalState: 'CONFIRMED' }); // second call: any doc

      await expect(
        service.createPendingDocumentForClientReturn({ clientReturnId: 'cr-no-inv', tx: prisma }),
      ).rejects.toThrow(NoValidatedInvoiceForCreditNoteException);
    });

    it('throws DuplicateFiscalDocumentException when a CREDIT_NOTE already exists for this return', async () => {
      (prisma.clientReturn.findUnique as jest.Mock).mockResolvedValue({
        workstationId: 'ws-1',
        sale: { id: 'sale-1' },
      });
      (prisma.fiscalDocument.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 'inv-1', documentType: 'INVOICE', fiscalState: 'VALIDATED' })
        .mockResolvedValueOnce({ id: 'existing-cn', fiscalState: 'PENDING_GENERATION' });

      await expect(
        service.createPendingDocumentForClientReturn({ clientReturnId: 'cr-dup', tx: prisma }),
      ).rejects.toThrow(DuplicateFiscalDocumentException);
    });
  });

  // ── createPendingDocumentForContingency ───────────────────────────────

  describe('createPendingDocumentForContingency', () => {
    it('returns existing document when one already exists in non-terminal state', async () => {
      (prisma.fiscalDocument.findFirst as jest.Mock).mockResolvedValue({
        id: 'existing-cont',
        fiscalState: 'CONTINGENCY',
      });

      const result = await service.createPendingDocumentForContingency({
        saleId: 'sale-cont',
        workstationId: 'ws-1',
        provisionalCufe: 'PROV_CUFE_123',
        tx: prisma,
      });

      expect(result).toEqual({ id: 'existing-cont' });
      expect(prisma.fiscalDocument.create).not.toHaveBeenCalled();
    });

    it('resets existing document if in GENERATION_ERROR state', async () => {
      (prisma.fiscalDocument.findFirst as jest.Mock).mockResolvedValue({
        id: 'existing-err',
        fiscalState: 'GENERATION_ERROR',
      });
      (prisma.fiscalDocument.update as jest.Mock).mockResolvedValue({});

      const result = await service.createPendingDocumentForContingency({
        saleId: 'sale-err',
        workstationId: 'ws-1',
        provisionalCufe: 'PROV_CUFE_ERR',
        tx: prisma,
      });

      expect(result).toEqual({ id: 'existing-err' });
      expect(prisma.fiscalDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'existing-err' },
          data: expect.objectContaining({ fiscalState: 'PENDING_GENERATION' }),
        }),
      );
    });

    it('creates a new CONTINGENCY document when no existing document', async () => {
      (prisma.fiscalDocument.findFirst as jest.Mock).mockResolvedValue(null); // no existing
      (prisma.fiscalResolutionAllocation.findFirst as jest.Mock).mockResolvedValue({
        id: 'alloc-cont',
        rangeTo: 500,
        resolution: { id: 'res-cont', prefix: 'CON' },
      });
      (prisma.fiscalResolutionAllocation.update as jest.Mock).mockResolvedValue({
        id: 'alloc-cont',
        currentConsecutive: 88,
        rangeTo: 500,
      });
      (prisma.fiscalIssuerConfig.findFirst as jest.Mock).mockResolvedValue({ nit: '900123456' });
      (prisma.fiscalDocument.create as jest.Mock).mockResolvedValue({ id: 'fd-cont-new' });

      const result = await service.createPendingDocumentForContingency({
        saleId: 'sale-new-cont',
        workstationId: 'ws-1',
        provisionalCufe: 'PROV_CUFE_NEW',
        tx: prisma,
      });

      expect(result).toBeDefined();
      expect(prisma.fiscalDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            documentType: 'INVOICE',
            fiscalState: 'CONTINGENCY',
            saleId: 'sale-new-cont',
            cufeCude: 'PROV_CUFE_NEW',
          }),
        }),
      );
    });
  });

  // ── enqueueGenerationJob ──────────────────────────────────────────────

  describe('enqueueGenerationJob', () => {
    it('calls queue.add with generate and fiscalDocumentId', async () => {
      await service.enqueueGenerationJob('fd-enq-1');

      expect(queue.add).toHaveBeenCalledWith('generate', { fiscalDocumentId: 'fd-enq-1' });
    });
  });
});
