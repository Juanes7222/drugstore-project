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
import { ContingencyResultWriter } from './contingency-result.writer';

describe('FiscalProcessingProcessor', () => {
  let processor: FiscalProcessingProcessor;
  let prisma: DeepMockProxy<PrismaClient>;
  let documentsService: { generate: jest.Mock };
  let transmissionService: { transmit: jest.Mock };
  let contingencyResultWriter: { writeForDocument: jest.Mock };

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
    contingencyResultWriter = { writeForDocument: jest.fn().mockResolvedValue(undefined) };
    (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(pendingDoc);
    processor = new FiscalProcessingProcessor(
      documentsService as unknown as FiscalDocumentsService,
      transmissionService as unknown as FiscalTransmissionService,
      contingencyResultWriter as unknown as ContingencyResultWriter,
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

    it('does not write a contingency result for a non-contingency document', async () => {
      await processor.process(job());

      expect(contingencyResultWriter.writeForDocument).not.toHaveBeenCalled();
    });

    it('moves the document to GENERATION_ERROR and rethrows when generation fails', async () => {
      documentsService.generate.mockRejectedValue(new Error('CUFE failed'));

      await expect(processor.process(job())).rejects.toThrow('CUFE failed');
      expect(prisma.fiscalDocument.update).toHaveBeenCalledWith({
        where: { id: 'fd-1' },
        data: { fiscalState: 'GENERATION_ERROR' },
      });
      expect(transmissionService.transmit).not.toHaveBeenCalled();
      expect(contingencyResultWriter.writeForDocument).not.toHaveBeenCalled();
    });

    it('still rethrows the original error when the error-state update itself fails', async () => {
      documentsService.generate.mockRejectedValue(new Error('CUFE failed'));
      (prisma.fiscalDocument.update as jest.Mock).mockRejectedValue(new Error('db down'));

      await expect(processor.process(job())).rejects.toThrow('CUFE failed');
    });

    it('rethrows transmission failures so BullMQ can retry the job', async () => {
      transmissionService.transmit.mockRejectedValue(new Error('DIAN timeout'));

      await expect(processor.process(job())).rejects.toThrow('DIAN timeout');
      expect(contingencyResultWriter.writeForDocument).not.toHaveBeenCalled();
    });

    it('delegates the contingency result write for a contingency document', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue({
        ...pendingDoc,
        contingencyReason: 'DISASTER',
      });

      await processor.process(job());

      expect(contingencyResultWriter.writeForDocument).toHaveBeenCalledWith('fd-1');
    });

    it('still delegates to the writer when the initial lookup finds nothing (writer no-ops)', async () => {
      // initialDoc?.contingencyReason is undefined, which is !== null, so the
      // processor treats the document as contingency-origin; the writer is
      // responsible for no-opping on a missing document.
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(null);

      await processor.process(job());

      expect(contingencyResultWriter.writeForDocument).toHaveBeenCalledWith('fd-1');
    });
  });
});