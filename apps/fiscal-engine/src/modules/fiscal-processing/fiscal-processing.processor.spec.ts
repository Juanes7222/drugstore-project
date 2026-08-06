import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

// The Prisma 7 client is generated at build time; keep the real package out
// of the module graph so the spec can run without the generated client.
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { FiscalProcessingProcessor } from './fiscal-processing.processor';
import { FiscalDocumentsService } from './fiscal-documents.service';
import { FiscalTransmissionService } from './fiscal-transmission.service';

describe('FiscalProcessingProcessor', () => {
  let processor: FiscalProcessingProcessor;
  let prisma: DeepMockProxy<PrismaClient>;
  let documentsService: { generate: jest.Mock };
  let transmissionService: { transmit: jest.Mock };

  const job = (overrides: Record<string, unknown> = {}) =>
    ({ id: 'job-1', data: { fiscalDocumentId: 'fd-1' }, ...overrides }) as any;

  const pendingDoc = {
    id: 'fd-1',
    fiscalState: 'PENDING_GENERATION',
    contingencyReason: null,
    saleId: 'sale-1',
  };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    documentsService = { generate: jest.fn().mockResolvedValue(undefined) };
    transmissionService = { transmit: jest.fn().mockResolvedValue(undefined) };
    (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(pendingDoc);
    processor = new FiscalProcessingProcessor(
      documentsService as unknown as FiscalDocumentsService,
      transmissionService as unknown as FiscalTransmissionService,
      prisma as any,
    );
  });

  describe('onFailed', () => {
    it('logs the failure without throwing', () => {
      expect(() =>
        processor.onFailed(job(), new Error('permanent failure')),
      ).not.toThrow();
    });
  });

  describe('process', () => {
    it('generates and transmits the document in the same job', async () => {
      await processor.process(job());

      expect(documentsService.generate).toHaveBeenCalledWith('fd-1');
      expect(transmissionService.transmit).toHaveBeenCalledWith('fd-1');
    });

    it('does not write a SyncInvoiceResult for a non-contingency document', async () => {
      await processor.process(job());

      expect(prisma.syncInvoiceResult.upsert).not.toHaveBeenCalled();
    });

    it('moves the document to GENERATION_ERROR and rethrows when generation fails', async () => {
      documentsService.generate.mockRejectedValue(new Error('CUFE failed'));

      await expect(processor.process(job())).rejects.toThrow('CUFE failed');
      expect(prisma.fiscalDocument.update).toHaveBeenCalledWith({
        where: { id: 'fd-1' },
        data: { fiscalState: 'GENERATION_ERROR' },
      });
      expect(transmissionService.transmit).not.toHaveBeenCalled();
    });

    it('still rethrows the original error when the error-state update itself fails', async () => {
      documentsService.generate.mockRejectedValue(new Error('CUFE failed'));
      (prisma.fiscalDocument.update as jest.Mock).mockRejectedValue(new Error('db down'));

      await expect(processor.process(job())).rejects.toThrow('CUFE failed');
    });

    it('rethrows transmission failures so BullMQ can retry the job', async () => {
      transmissionService.transmit.mockRejectedValue(new Error('DIAN timeout'));

      await expect(processor.process(job())).rejects.toThrow('DIAN timeout');
    });

    it('writes an AUTHORIZED SyncInvoiceResult for a validated contingency document', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue({
        ...pendingDoc,
        contingencyReason: 'DISASTER',
      });
      (prisma.sale.findUnique as jest.Mock).mockResolvedValue({
        sourceWorkstationId: 'ws-1',
      });
      (prisma.fiscalDocument.update as jest.Mock).mockResolvedValue({});
      const transmittedDoc = {
        id: 'fd-1',
        subscriptionId: 'sub-1',
        cufeCude: 'cufe-123',
        signedXml: '<Signed/>',
        fiscalState: 'VALIDATED',
        ptResponseCode: '00',
        ptResponseMessage: 'Ok',
        saleId: 'sale-1',
      };
      (prisma.fiscalDocument.findUnique as jest.Mock)
        .mockResolvedValueOnce({ ...pendingDoc, contingencyReason: 'DISASTER' })
        .mockResolvedValueOnce(transmittedDoc);

      await processor.process(job());

      expect(prisma.syncInvoiceResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: expect.any(String) },
          create: expect.objectContaining({
            subscriptionId: 'sub-1',
            workstationId: 'ws-1',
            status: 'AUTHORIZED',
            cufeOfficial: 'cufe-123',
            dianXml: '<Signed/>',
            authorizedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('writes a REJECTED SyncInvoiceResult with the DIAN reason for a rejected contingency document', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock)
        .mockResolvedValueOnce({ ...pendingDoc, contingencyReason: 'DISASTER' })
        .mockResolvedValueOnce({
          id: 'fd-1',
          subscriptionId: 'sub-1',
          cufeCude: null,
          signedXml: null,
          fiscalState: 'REJECTED',
          ptResponseCode: '05',
          ptResponseMessage: 'Firma inválida',
          saleId: 'sale-1',
        });
      (prisma.sale.findUnique as jest.Mock).mockResolvedValue({
        sourceWorkstationId: 'ws-1',
      });

      await processor.process(job());

      expect(prisma.syncInvoiceResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: 'REJECTED',
            rejectionReason: 'Firma inválida',
          }),
        }),
      );
    });

    it('skips the SyncInvoiceResult write when the sale has no workstation', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock)
        .mockResolvedValueOnce({ ...pendingDoc, contingencyReason: 'DISASTER' })
        .mockResolvedValueOnce({
          id: 'fd-1',
          subscriptionId: 'sub-1',
          cufeCude: 'cufe-123',
          signedXml: null,
          fiscalState: 'VALIDATED',
          ptResponseCode: '00',
          ptResponseMessage: 'Ok',
          saleId: null,
        });

      await processor.process(job());

      expect(prisma.syncInvoiceResult.upsert).not.toHaveBeenCalled();
    });

    it('swallows SyncInvoiceResult write failures so the job still completes', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock)
        .mockResolvedValueOnce({ ...pendingDoc, contingencyReason: 'DISASTER' })
        .mockResolvedValueOnce({
          id: 'fd-1',
          subscriptionId: 'sub-1',
          cufeCude: 'cufe-123',
          signedXml: null,
          fiscalState: 'VALIDATED',
          ptResponseCode: '00',
          ptResponseMessage: 'Ok',
          saleId: 'sale-1',
        });
      (prisma.sale.findUnique as jest.Mock).mockResolvedValue({
        sourceWorkstationId: 'ws-1',
      });
      (prisma.syncInvoiceResult.upsert as jest.Mock).mockRejectedValue(new Error('db down'));

      await expect(processor.process(job())).resolves.toBeUndefined();
    });
  });
});
