import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

// The Prisma 7 client is generated at build time; keep the real package out
// of the module graph so the spec can run without the generated client.
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { ContingencyResultWriter } from './contingency-result.writer';

describe('ContingencyResultWriter', () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let writer: ContingencyResultWriter;

  const validatedDoc = {
    id: 'fd-1',
    subscriptionId: 'sub-1',
    cufeCude: 'cufe-123',
    signedXml: '<Signed/>',
    fiscalState: 'VALIDATED',
    ptResponseCode: '00',
    ptResponseMessage: 'Ok',
    saleId: 'sale-1',
  };

  const rejectedDoc = {
    ...validatedDoc,
    cufeCude: null,
    signedXml: null,
    fiscalState: 'REJECTED',
    ptResponseCode: '05',
    ptResponseMessage: 'Firma inválida',
  };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    writer = new ContingencyResultWriter(prisma as any);
  });

  describe('writeForDocument', () => {
    it('writes an AUTHORIZED SyncInvoiceResult for a VALIDATED document', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(validatedDoc);
      (prisma.sale.findUnique as jest.Mock).mockResolvedValue({
        sourceWorkstationId: 'ws-1',
      });
      (prisma.syncInvoiceResult.upsert as jest.Mock).mockResolvedValue({});

      await writer.writeForDocument('fd-1');

      expect(prisma.fiscalDocument.findUnique).toHaveBeenCalledWith({
        where: { id: 'fd-1' },
        select: {
          id: true,
          subscriptionId: true,
          cufeCude: true,
          signedXml: true,
          fiscalState: true,
          ptResponseCode: true,
          ptResponseMessage: true,
          saleId: true,
        },
      });
      expect(prisma.sale.findUnique).toHaveBeenCalledWith({
        where: { id: 'sale-1' },
        select: { sourceWorkstationId: true },
      });
      expect(prisma.syncInvoiceResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: expect.any(String) },
          create: expect.objectContaining({
            subscriptionId: 'sub-1',
            invoiceId: 'sale-1',
            workstationId: 'ws-1',
            status: 'AUTHORIZED',
            cufeOfficial: 'cufe-123',
            dianXml: '<Signed/>',
            rejectionReason: null,
            authorizedAt: expect.any(Date),
          }),
          update: expect.objectContaining({
            status: 'AUTHORIZED',
            cufeOfficial: 'cufe-123',
            dianXml: '<Signed/>',
            rejectionReason: null,
            authorizedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('writes a REJECTED SyncInvoiceResult with the DIAN reason for a REJECTED document', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(rejectedDoc);
      (prisma.sale.findUnique as jest.Mock).mockResolvedValue({
        sourceWorkstationId: 'ws-1',
      });
      (prisma.syncInvoiceResult.upsert as jest.Mock).mockResolvedValue({});

      await writer.writeForDocument('fd-1');

      expect(prisma.syncInvoiceResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: 'REJECTED',
            rejectionReason: 'Firma inválida',
            authorizedAt: null,
          }),
          update: expect.objectContaining({
            status: 'REJECTED',
            rejectionReason: 'Firma inválida',
            authorizedAt: null,
          }),
        }),
      );
    });

    it('falls back to the response code when no message is present', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue({
        ...rejectedDoc,
        ptResponseMessage: null,
      });
      (prisma.sale.findUnique as jest.Mock).mockResolvedValue({
        sourceWorkstationId: 'ws-1',
      });
      (prisma.syncInvoiceResult.upsert as jest.Mock).mockResolvedValue({});

      await writer.writeForDocument('fd-1');

      const upsertCall = (prisma.syncInvoiceResult.upsert as jest.Mock).mock.calls[0][0];
      expect(upsertCall.create.rejectionReason).toBe('05');
    });

    it('is a no-op when the document does not exist', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(null);

      await writer.writeForDocument('missing');

      expect(prisma.sale.findUnique).not.toHaveBeenCalled();
      expect(prisma.syncInvoiceResult.upsert).not.toHaveBeenCalled();
    });

    it('is a no-op when the sale has no sourceWorkstationId', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(validatedDoc);
      (prisma.sale.findUnique as jest.Mock).mockResolvedValue({
        sourceWorkstationId: null,
      });

      await writer.writeForDocument('fd-1');

      expect(prisma.syncInvoiceResult.upsert).not.toHaveBeenCalled();
    });

    it('is a no-op when the document has no sale', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue({
        ...validatedDoc,
        saleId: null,
      });

      await writer.writeForDocument('fd-1');

      expect(prisma.sale.findUnique).not.toHaveBeenCalled();
      expect(prisma.syncInvoiceResult.upsert).not.toHaveBeenCalled();
    });

    it('swallows errors so the surrounding job never fails', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(validatedDoc);
      (prisma.sale.findUnique as jest.Mock).mockRejectedValue(new Error('db down'));

      await expect(writer.writeForDocument('fd-1')).resolves.toBeUndefined();
    });
  });
});