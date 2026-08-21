import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

// The Prisma 7 client is generated at build time; keep the real package out
// of the module graph so the spec can run without the generated client.
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { FiscalWebhookProcessor } from './fiscal-webhook.processor';
import { FiscalTransmissionService } from './fiscal-transmission.service';
import { ContingencyResultWriter } from './contingency-result.writer';

describe('FiscalWebhookProcessor', () => {
  let processor: FiscalWebhookProcessor;
  let prisma: DeepMockProxy<PrismaClient>;
  let transmissionService: { applyTransmissionResult: jest.Mock };
  let contingencyResultWriter: { writeForDocument: jest.Mock };

  const job = (eventId: string) =>
    ({ id: 'job-1', data: { eventId } }) as any;

  const receivedEvent = (overrides: Record<string, unknown> = {}) => ({
    id: 'evt-1',
    status: 'RECEIVED',
    fiscalDocumentId: 'fd-1',
    outcome: 'VALIDATED',
    cufe: 'cufe-123',
    signedXml: '<SignedInvoice/>',
    responseCode: '00',
    responseMessage: 'Ok',
    ...overrides,
  });

  const inTransmissionDoc = {
    id: 'fd-1',
    fiscalState: 'IN_TRANSMISSION',
    contingencyReason: null,
  };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    transmissionService = { applyTransmissionResult: jest.fn().mockResolvedValue(undefined) };
    contingencyResultWriter = { writeForDocument: jest.fn().mockResolvedValue(undefined) };
    processor = new FiscalWebhookProcessor(
      prisma as any,
      transmissionService as unknown as FiscalTransmissionService,
      contingencyResultWriter as unknown as ContingencyResultWriter,
    );
  });

  describe('process', () => {
    it('ignores a missing event', async () => {
      (prisma.fiscalWebhookEvent.findUnique as jest.Mock).mockResolvedValue(null);

      await processor.process(job('missing'));

      expect(prisma.fiscalDocument.findUnique).not.toHaveBeenCalled();
      expect(prisma.fiscalWebhookEvent.update).not.toHaveBeenCalled();
    });

    it('ignores an event that was already processed', async () => {
      (prisma.fiscalWebhookEvent.findUnique as jest.Mock).mockResolvedValue(
        receivedEvent({ status: 'PROCESSED' }),
      );

      await processor.process(job('evt-1'));

      expect(prisma.fiscalWebhookEvent.update).not.toHaveBeenCalled();
      expect(transmissionService.applyTransmissionResult).not.toHaveBeenCalled();
    });

    it('marks FAILED when the event has no correlated document', async () => {
      (prisma.fiscalWebhookEvent.findUnique as jest.Mock).mockResolvedValue(
        receivedEvent({ fiscalDocumentId: null }),
      );

      await processor.process(job('evt-1'));

      expect(prisma.fiscalWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: {
          status: 'FAILED',
          processingError: 'Event has no correlated document or outcome',
          processedAt: expect.any(Date),
        },
      });
      expect(prisma.fiscalDocument.findUnique).not.toHaveBeenCalled();
    });

    it('marks FAILED when the outcome is null', async () => {
      (prisma.fiscalWebhookEvent.findUnique as jest.Mock).mockResolvedValue(
        receivedEvent({ outcome: null }),
      );

      await processor.process(job('evt-1'));

      expect(prisma.fiscalWebhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
    });

    it('marks FAILED when the correlated document is not found', async () => {
      (prisma.fiscalWebhookEvent.findUnique as jest.Mock).mockResolvedValue(
        receivedEvent(),
      );
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(null);

      await processor.process(job('evt-1'));

      expect(prisma.fiscalWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: {
          status: 'FAILED',
          processingError: 'Document fd-1 not found',
          processedAt: expect.any(Date),
        },
      });
    });

    it('acknowledges an OTHER outcome without touching the document', async () => {
      (prisma.fiscalWebhookEvent.findUnique as jest.Mock).mockResolvedValue(
        receivedEvent({ outcome: 'OTHER' }),
      );
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(inTransmissionDoc);

      await processor.process(job('evt-1'));

      expect(prisma.fiscalWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: { status: 'PROCESSED', processedAt: expect.any(Date) },
      });
      expect(transmissionService.applyTransmissionResult).not.toHaveBeenCalled();
      expect(contingencyResultWriter.writeForDocument).not.toHaveBeenCalled();
    });

    it('applies a VALIDATED outcome and writes the contingency result when the document is contingency-origin', async () => {
      (prisma.fiscalWebhookEvent.findUnique as jest.Mock).mockResolvedValue(
        receivedEvent(),
      );
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue({
        ...inTransmissionDoc,
        contingencyReason: 'DISASTER',
      });

      await processor.process(job('evt-1'));

      expect(transmissionService.applyTransmissionResult).toHaveBeenCalledWith(
        'fd-1',
        {
          isValid: true,
          xmlDocumentKey: 'cufe-123',
          signedXml: '<SignedInvoice/>',
          statusCode: '00',
          statusMessage: 'Ok',
        },
      );
      expect(contingencyResultWriter.writeForDocument).toHaveBeenCalledWith('fd-1');
      expect(prisma.fiscalWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: { status: 'PROCESSED', processedAt: expect.any(Date) },
      });
    });

    it('applies a VALIDATED outcome without a contingency write for a direct document', async () => {
      (prisma.fiscalWebhookEvent.findUnique as jest.Mock).mockResolvedValue(
        receivedEvent(),
      );
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(inTransmissionDoc);

      await processor.process(job('evt-1'));

      expect(transmissionService.applyTransmissionResult).toHaveBeenCalledWith(
        'fd-1',
        expect.objectContaining({ isValid: true }),
      );
      expect(contingencyResultWriter.writeForDocument).not.toHaveBeenCalled();
    });

    it('applies a REJECTED outcome with isValid false', async () => {
      (prisma.fiscalWebhookEvent.findUnique as jest.Mock).mockResolvedValue(
        receivedEvent({
          outcome: 'REJECTED',
          cufe: null,
          signedXml: null,
          responseCode: '05',
          responseMessage: 'Firma inválida',
        }),
      );
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(inTransmissionDoc);

      await processor.process(job('evt-1'));

      expect(transmissionService.applyTransmissionResult).toHaveBeenCalledWith(
        'fd-1',
        {
          isValid: false,
          xmlDocumentKey: null,
          signedXml: null,
          statusCode: '05',
          statusMessage: 'Firma inválida',
        },
      );
    });

    it('only marks PROCESSED when the document is already in a terminal state', async () => {
      (prisma.fiscalWebhookEvent.findUnique as jest.Mock).mockResolvedValue(
        receivedEvent(),
      );
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue({
        ...inTransmissionDoc,
        fiscalState: 'VALIDATED',
      });

      await processor.process(job('evt-1'));

      expect(prisma.fiscalWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: { status: 'PROCESSED', processedAt: expect.any(Date) },
      });
      expect(transmissionService.applyTransmissionResult).not.toHaveBeenCalled();
      expect(contingencyResultWriter.writeForDocument).not.toHaveBeenCalled();
    });
  });
});