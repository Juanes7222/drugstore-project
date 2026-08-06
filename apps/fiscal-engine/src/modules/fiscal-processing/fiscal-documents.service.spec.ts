import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

// The Prisma 7 client is generated at build time; keep the real package out
// of the module graph so the spec can run without the generated client.
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { FiscalDocumentsService } from './fiscal-documents.service';
import { FiscalDocumentGenerationFailedException } from './exceptions/fiscal-document-generation-failed.exception';
import { CufeCalculator } from './builders/cufe.calculator';
import { UblInvoiceBuilder } from './builders/ubl-invoice.builder';
import type { FiscalTransmissionPort } from './ports/fiscal-transmission.port';
import type { SecretReaderPort } from './ports/secret-reader.port';

function createTransmissionFake() {
  return {
    signAndSend: jest.fn(),
    checkStatus: jest.fn(),
    getNumberingRange: jest.fn().mockResolvedValue({ clTec: 'CLTEC-ABC-123' }),
  } as unknown as FiscalTransmissionPort;
}

function createSecretReaderFake() {
  return {
    readSecret: jest.fn().mockResolvedValue({
      certificate: Buffer.from('fake-p12-bytes'),
      password: 'test-password',
      softwareSecurityCode: 'abcdef0123456789abcdef0123456789abcdef0123456789ab',
    }),
  } as unknown as SecretReaderPort;
}

const ISSUE_DATE = new Date(2026, 7, 5, 10, 53, 10);

const DOC_WITH_RESOLUTION = {
  id: 'fd-1',
  fullNumber: 'FV-DEMO-000001',
  fiscalState: 'PENDING_GENERATION',
  documentType: 'INVOICE',
  issueDate: ISSUE_DATE,
  saleId: 'sale-1',
  resolution: {
    resolutionNumber: '18764000000001',
    validFrom: new Date(2026, 0, 1),
    validTo: new Date(2026, 11, 31),
    prefix: 'FV',
    rangeFrom: 1,
    rangeTo: 1000,
  },
};

const SALE = {
  id: 'sale-1',
  clientId: 'client-1',
  subtotal: 1000000,
  totalTax: 190000,
  totalAmount: 1190000,
  totalDiscount: 0,
};

const SALE_ITEM = {
  id: 'item-1',
  saleId: 'sale-1',
  quantity: 2,
  subtotal: 1000000,
  taxAmount: 190000,
  taxRate: 19,
  productCommercialNameSnapshot: 'Paracetamol 500mg',
  productInternalCodeSnapshot: 'P001',
  unitPrice: 500000,
};

const ISSUER_CONFIG = {
  nit: '800197268',
  verificationDigit: '4',
  businessName: 'FARMACIA DEMO SA',
  municipality: 'Bogotá D.C.',
  department: 'Cundinamarca',
  softwareId: 'b8ac9b7c-3f2e-4a6d-9c1e-5f7a8b9c0d1e',
};

const CUSTOMER = {
  id: 'client-1',
  identificationNumber: '123456789',
  identificationType: 'CC',
  fullName: 'JUAN PEREZ',
};

const TECH_CONFIG = {
  credentialReference: 'file:test-cert.json',
  environment: '2',
};

describe('FiscalDocumentsService', () => {
  let service: FiscalDocumentsService;
  let prisma: DeepMockProxy<PrismaClient>;
  let transmission: ReturnType<typeof createTransmissionFake>;
  let secrets: ReturnType<typeof createSecretReaderFake>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    transmission = createTransmissionFake();
    secrets = createSecretReaderFake();
    (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(DOC_WITH_RESOLUTION);
    (prisma.sale.findUnique as jest.Mock).mockResolvedValue(SALE);
    (prisma.saleItem.findMany as jest.Mock).mockResolvedValue([SALE_ITEM]);
    (prisma.fiscalIssuerConfig.findFirst as jest.Mock).mockResolvedValue(ISSUER_CONFIG);
    (prisma.client.findUnique as jest.Mock).mockResolvedValue(CUSTOMER);
    (prisma.techProviderConfig.findFirst as jest.Mock).mockResolvedValue(TECH_CONFIG);
    service = new FiscalDocumentsService(
      prisma as any,
      new CufeCalculator(),
      new UblInvoiceBuilder(new CufeCalculator()),
      transmission,
      secrets,
    );
  });

  describe('generate', () => {
    it('computes the CUFE, builds the UBL XML, and persists the GENERATED document', async () => {
      await service.generate('fd-1');

      expect(prisma.fiscalDocument.update).toHaveBeenCalledWith({
        where: { id: 'fd-1' },
        data: expect.objectContaining({
          fiscalState: 'GENERATED',
          cufeCude: expect.stringMatching(/^[0-9a-f]{96}$/),
          xmlPayload: expect.stringContaining('<Invoice'),
          receiverNitSnapshot: '123456789',
          receiverNameSnapshot: 'JUAN PEREZ',
          receiverType: 'CC',
        }),
      });
    });

    it('embeds the full number in the generated XML', async () => {
      await service.generate('fd-1');

      const updateData = (prisma.fiscalDocument.update as jest.Mock).mock.calls[0][0].data;
      expect(updateData.xmlPayload).toContain('<cbc:ID>FV-DEMO-000001</cbc:ID>');
    });

    it('fetches the ClTec live from DIAN before computing the CUFE', async () => {
      await service.generate('fd-1');

      expect(transmission.getNumberingRange).toHaveBeenCalledWith(
        Buffer.from('fake-p12-bytes'),
        'test-password',
        '2',
        '18764000000001',
      );
    });

    it('falls back to the final-consumer identity when the sale has no client', async () => {
      (prisma.sale.findUnique as jest.Mock).mockResolvedValue({ ...SALE, clientId: null });
      (prisma.client.findUnique as jest.Mock).mockClear();

      await service.generate('fd-1');

      const updateData = (prisma.fiscalDocument.update as jest.Mock).mock.calls[0][0].data;
      expect(updateData.receiverNitSnapshot).toBeNull();
      expect(prisma.client.findUnique).not.toHaveBeenCalled();
    });

    it('throws FiscalDocumentGenerationFailedException when the document does not exist', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.generate('missing')).rejects.toThrow(
        FiscalDocumentGenerationFailedException,
      );
      expect(prisma.fiscalDocument.update).not.toHaveBeenCalled();
    });

    it('throws FiscalDocumentGenerationFailedException when the document has no resolution', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue({
        ...DOC_WITH_RESOLUTION,
        resolution: null,
      });

      await expect(service.generate('fd-1')).rejects.toThrow(
        FiscalDocumentGenerationFailedException,
      );
    });

    it('throws FiscalDocumentGenerationFailedException when the document has no sale id', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue({
        ...DOC_WITH_RESOLUTION,
        saleId: null,
      });

      await expect(service.generate('fd-1')).rejects.toThrow(
        FiscalDocumentGenerationFailedException,
      );
      expect(prisma.sale.findUnique).not.toHaveBeenCalled();
    });

    it('throws FiscalDocumentGenerationFailedException when the sale is missing', async () => {
      (prisma.sale.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.generate('fd-1')).rejects.toThrow(
        FiscalDocumentGenerationFailedException,
      );
    });

    it('throws FiscalDocumentGenerationFailedException when the sale has no items', async () => {
      (prisma.saleItem.findMany as jest.Mock).mockResolvedValue([]);

      await expect(service.generate('fd-1')).rejects.toThrow(
        FiscalDocumentGenerationFailedException,
      );
    });

    it('throws FiscalDocumentGenerationFailedException when no issuer config exists', async () => {
      (prisma.fiscalIssuerConfig.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.generate('fd-1')).rejects.toThrow(
        FiscalDocumentGenerationFailedException,
      );
    });

    it('throws FiscalDocumentGenerationFailedException when no tech provider config exists', async () => {
      (prisma.techProviderConfig.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.generate('fd-1')).rejects.toThrow(
        FiscalDocumentGenerationFailedException,
      );
      expect(secrets.readSecret).not.toHaveBeenCalled();
    });
  });
});
