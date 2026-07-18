jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { FiscalDocumentsService } from './fiscal-documents.service';
import { DocumentNotRetryableException } from '../exceptions/document-not-retryable.exception';
import { DuplicateFiscalDocumentException } from '../exceptions/duplicate-fiscal-document.exception';
import { FiscalDocumentNotFoundException } from '../exceptions/fiscal-document-not-found.exception';
import { NoActiveResolutionForWorkstationException } from '../exceptions/no-active-resolution-for-workstation.exception';
import { NoValidatedInvoiceForCreditNoteException } from '../exceptions/no-validated-invoice-for-credit-note.exception';
import { ResolutionExhaustedException } from '../exceptions/resolution-exhausted.exception';

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

  // ── findAll ─────────────────────────────────────────────────────────────

  describe('findAll', () => {
    beforeEach(() => {
      // findAll uses array-form $transaction ([findMany, count])
      (prisma.$transaction as jest.Mock).mockImplementation(
        (args: any[]) => Promise.all(args),
      );
    });

    it('returns paginated documents with total count and includes', async () => {
      const mockDocs = [
        {
          id: 'fd-1',
          fiscalState: 'PENDING_GENERATION',
          resolution: { prefix: 'PRE', resolutionNumber: 1 },
          allocation: { workstationId: 'ws-1' },
        },
      ];
      (prisma.fiscalDocument.findMany as jest.Mock).mockResolvedValue(mockDocs);
      (prisma.fiscalDocument.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({ page: 1, pageSize: 20 });

      expect(result).toEqual({ data: mockDocs, total: 1, page: 1, pageSize: 20 });
    });

    it('passes skip and take based on page and pageSize', async () => {
      (prisma.fiscalDocument.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fiscalDocument.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ page: 3, pageSize: 10 });

      expect(prisma.fiscalDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('orders by issueDate descending', async () => {
      (prisma.fiscalDocument.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fiscalDocument.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10 });

      expect(prisma.fiscalDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { issueDate: 'desc' } }),
      );
    });

    it('includes resolution and allocation in the query', async () => {
      (prisma.fiscalDocument.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fiscalDocument.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10 });

      expect(prisma.fiscalDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            resolution: { select: { prefix: true, resolutionNumber: true } },
            allocation: { select: { workstationId: true } },
          },
        }),
      );
    });

    it('filters by state when provided', async () => {
      (prisma.fiscalDocument.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fiscalDocument.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, state: 'VALIDATED' });

      expect(prisma.fiscalDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { fiscalState: 'VALIDATED' } }),
      );
    });

    it('filters by documentType when provided', async () => {
      (prisma.fiscalDocument.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fiscalDocument.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, documentType: 'INVOICE' });

      expect(prisma.fiscalDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { documentType: 'INVOICE' } }),
      );
    });

    it('filters by issueDate range when createdAtFrom and createdAtTo are provided', async () => {
      (prisma.fiscalDocument.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fiscalDocument.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        createdAtFrom: '2026-07-01',
        createdAtTo: '2026-07-10',
      });

      expect(prisma.fiscalDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { issueDate: { gte: expect.any(Date), lte: expect.any(Date) } },
        }),
      );
    });

    it('filters by issueDate gte only when only createdAtFrom is provided', async () => {
      (prisma.fiscalDocument.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fiscalDocument.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, createdAtFrom: '2026-07-01' });

      expect(prisma.fiscalDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { issueDate: { gte: expect.any(Date) } },
        }),
      );
    });

    it('counts documents with the same where filter as findMany', async () => {
      (prisma.fiscalDocument.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fiscalDocument.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, state: 'VALIDATED', documentType: 'INVOICE' });

      expect(prisma.fiscalDocument.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { fiscalState: 'VALIDATED', documentType: 'INVOICE' } }),
      );
    });
  });

  // ── findById ───────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the document with resolution, allocation, and referenceDocument when found', async () => {
      const mockDoc = {
        id: 'fd-1',
        resolution: { id: 'res-1', prefix: 'PRE', resolutionNumber: 1 },
        allocation: { id: 'alloc-1', workstationId: 'ws-1', workstation: { id: 'ws-1', name: 'Workstation 1' } },
        referenceDocument: null,
      };
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(mockDoc);

      const result = await service.findById('fd-1');

      expect(result).toEqual(mockDoc);
      expect(prisma.fiscalDocument.findUnique).toHaveBeenCalledWith({
        where: { id: 'fd-1' },
        include: {
          resolution: true,
          allocation: { include: { workstation: true } },
          referenceDocument: { select: { id: true, fullNumber: true, documentType: true, fiscalState: true } },
        },
      });
    });

    it('includes referenceDocument when present', async () => {
      const mockDoc = {
        id: 'fd-1',
        resolution: true,
        allocation: { include: { workstation: true } },
        referenceDocument: { id: 'ref-1', fullNumber: 'PRE100', documentType: 'INVOICE', fiscalState: 'VALIDATED' },
      };
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(mockDoc);

      const result = await service.findById('fd-1');

      expect(result.referenceDocument).toEqual(
        expect.objectContaining({ id: 'ref-1', fullNumber: 'PRE100' }),
      );
    });

    it('throws FiscalDocumentNotFoundException when not found', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(FiscalDocumentNotFoundException);
    });
  });

  // ── getXmlPayload ──────────────────────────────────────────────────────

  describe('getXmlPayload', () => {
    it('returns id, fiscalState, xmlPayload and signedXml when found', async () => {
      const mockDoc = {
        id: 'fd-1',
        xmlPayload: '<Invoice>...</Invoice>',
        signedXml: '<Signed>...</Signed>',
        fiscalState: 'VALIDATED',
      };
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(mockDoc);

      const result = await service.getXmlPayload('fd-1');

      expect(result).toEqual({
        id: 'fd-1',
        fiscalState: 'VALIDATED',
        xmlPayload: '<Invoice>...</Invoice>',
        signedXml: '<Signed>...</Signed>',
      });
    });

    it('selects only the required fields from the database', async () => {
      const mockDoc = {
        id: 'fd-1',
        xmlPayload: '<xml/>',
        signedXml: '<signed/>',
        fiscalState: 'PENDING_GENERATION',
      };
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(mockDoc);

      await service.getXmlPayload('fd-1');

      expect(prisma.fiscalDocument.findUnique).toHaveBeenCalledWith({
        where: { id: 'fd-1' },
        select: { id: true, xmlPayload: true, signedXml: true, fiscalState: true },
      });
    });

    it('throws FiscalDocumentNotFoundException when not found', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getXmlPayload('missing')).rejects.toThrow(FiscalDocumentNotFoundException);
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
      (prisma.fiscalDocument.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.sale.findUnique as jest.Mock).mockResolvedValue({ workstationId: 'ws-1' });
      (prisma.fiscalResolutionAllocation.findFirst as jest.Mock).mockResolvedValue({
        id: 'alloc-1',
        rangeFrom: 1,
        rangeTo: 500,
        resolution: { id: 'res-1', prefix: 'PRE' },
      });
      (prisma.fiscalResolutionAllocation.update as jest.Mock).mockResolvedValue({
        id: 'alloc-1',
        currentConsecutive: 501,
        rangeTo: 500,
      });
      (prisma.fiscalIssuerConfig.findFirst as jest.Mock).mockResolvedValue({ nit: '900123456' });

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
