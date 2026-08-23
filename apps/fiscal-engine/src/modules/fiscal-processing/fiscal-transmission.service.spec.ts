import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

// The Prisma 7 client is generated at build time; keep the real package out
// of the module graph so the spec can run without the generated client.
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { FiscalTransmissionService } from './fiscal-transmission.service';
import { FiscalTransmissionFailedException } from './exceptions/fiscal-transmission-failed.exception';
import { FiscalDocumentRejectedException } from './exceptions/fiscal-document-rejected.exception';
import { TechProviderConfigNotFoundException } from './exceptions/tech-provider-config-not-found.exception';
import type { FiscalTransmissionPort } from './ports/fiscal-transmission.port';
import type { SecretReaderPort, SecretData } from './ports/secret-reader.port';
import type { SendResult } from './ports/transmission-results.type';
import type { TransmissionRouteResolver } from './transmission-route.resolver';

// Hand-written fakes for the ports, per the hexagonal convention: the
// contract lives in the test so port/adapter drift surfaces as a failure
// instead of being absorbed by a permissive deep mock.
function createTransmissionFake() {
  return {
    signAndSend: jest.fn<Promise<SendResult>, any[]>(),
    checkStatus: jest.fn(),
    getNumberingRange: jest.fn(),
  } as unknown as FiscalTransmissionPort;
}

function createSecretReaderFake() {
  const secretData: SecretData = {
    certificate: Buffer.from('fake-p12-bytes'),
    password: 'test-password',
    softwareSecurityCode: 'abcdef0123456789abcdef0123456789abcdef0123456789ab',
  };
  return {
    readSecret: jest.fn<Promise<SecretData>, any[]>().mockResolvedValue(secretData),
  } as unknown as SecretReaderPort;
}

const PENDING_DOC = {
  id: 'fd-1',
  subscriptionId: 'sub-test',
  fullNumber: 'FV-DEMO-000001',
  fiscalState: 'PENDING_SIGNATURE',
  xmlPayload: '<Invoice/>',
};

describe('FiscalTransmissionService', () => {
  let service: FiscalTransmissionService;
  let prisma: DeepMockProxy<PrismaClient>;
  let transmission: ReturnType<typeof createTransmissionFake>;
  let secrets: ReturnType<typeof createSecretReaderFake>;
  let routeResolver: { resolve: jest.Mock };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    transmission = createTransmissionFake();
    secrets = createSecretReaderFake();
    routeResolver = { resolve: jest.fn().mockResolvedValue('DIAN_DIRECT') };
    (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(PENDING_DOC);
    (prisma.fiscalDocument.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.techProviderConfig.findFirst as jest.Mock).mockResolvedValue({
      credentialReference: 'file:test-cert.json',
      environment: '2',
    });
    service = new FiscalTransmissionService(
      prisma as any,
      transmission,
      secrets,
      routeResolver as unknown as TransmissionRouteResolver,
    );
  });

  describe('transmit', () => {
    it('claims the document and transitions to VALIDATED on a valid response', async () => {
      transmission.signAndSend.mockResolvedValue({
        isValid: true,
        xmlDocumentKey: 'cufe-123',
        signedXml: '<SignedInvoice/>',
        statusMessage: 'Documento procesado',
        statusCode: '00',
      });

      await service.transmit('fd-1');

      // FIX-008: the atomic claim must be the only way out of
      // PENDING_SIGNATURE — a second worker finds zero rows and aborts.
      // The claim also records the transmitting party for webhook correlation.
      expect(prisma.fiscalDocument.updateMany).toHaveBeenCalledWith({
        where: { id: 'fd-1', fiscalState: 'PENDING_SIGNATURE' },
        data: {
          fiscalState: 'IN_TRANSMISSION',
          providerType: 'DIAN_DIRECT',
          lastRetryAt: expect.any(Date),
        },
      });
      // The provider config lookup is scoped to the document's subscription
      // so one tenant can never resolve another tenant's credentials.
      expect(prisma.techProviderConfig.findFirst).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-test' },
      });
      // CERTIFICATE/legacy route: the tenant's own certificate, so the
      // reference handed to the secret reader is empty.
      expect(secrets.readSecret).toHaveBeenCalledWith('sub-test', '');
      expect(transmission.signAndSend).toHaveBeenCalledWith(
        '<Invoice/>',
        'FV-DEMO-000001.xml',
        Buffer.from('fake-p12-bytes'),
        'test-password',
        '2',
      );
      expect(prisma.fiscalDocument.update).toHaveBeenCalledWith({
        where: { id: 'fd-1' },
        data: {
          cufeCude: 'cufe-123',
          signedXml: '<SignedInvoice/>',
          fiscalState: 'VALIDATED',
          // The direct path correlates future webhook/status flows on the
          // DIAN-issued key, so it is stored as providerTrackId too.
          providerTrackId: 'cufe-123',
          ptResponseCode: '00',
          ptResponseMessage: 'Documento procesado',
        },
      });
    });

    it('resolves server-side credentials and stamps the provider type on a PROVIDER route', async () => {
      routeResolver.resolve.mockResolvedValue('PROVIDER');
      (prisma.techProviderConfig.findFirst as jest.Mock).mockResolvedValue({
        credentialReference: 'file:test-cert.json',
        environment: '2',
        providerType: 'TECH_PROVIDER',
      });
      transmission.signAndSend.mockResolvedValue({
        isValid: true,
        xmlDocumentKey: 'cufe-123',
        signedXml: '<SignedInvoice/>',
        statusMessage: 'Documento procesado',
        statusCode: '00',
      });

      await service.transmit('fd-1');

      expect(secrets.readSecret).toHaveBeenCalledWith(
        'sub-test',
        'file:test-cert.json',
      );
      expect(prisma.fiscalDocument.updateMany).toHaveBeenCalledWith({
        where: { id: 'fd-1', fiscalState: 'PENDING_SIGNATURE' },
        data: {
          fiscalState: 'IN_TRANSMISSION',
          providerType: 'TECH_PROVIDER',
          lastRetryAt: expect.any(Date),
        },
      });
    });

    it('throws FiscalTransmissionFailedException when a PROVIDER plan has no credentialReference', async () => {
      routeResolver.resolve.mockResolvedValue('PROVIDER');
      (prisma.techProviderConfig.findFirst as jest.Mock).mockResolvedValue({
        credentialReference: null,
        environment: '2',
      });

      await expect(service.transmit('fd-1')).rejects.toThrow(
        FiscalTransmissionFailedException,
      );
      await expect(service.transmit('fd-1')).rejects.toThrow(
        'plan uses provider transmission but TechProviderConfig has no credentialReference',
      );
      expect(secrets.readSecret).not.toHaveBeenCalled();
      expect(prisma.fiscalDocument.updateMany).not.toHaveBeenCalled();
    });

    it('throws FiscalTransmissionFailedException when the document does not exist', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.transmit('missing')).rejects.toThrow(FiscalTransmissionFailedException);
      expect(transmission.signAndSend).not.toHaveBeenCalled();
    });

    it('throws FiscalTransmissionFailedException when the document is not in PENDING_SIGNATURE', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue({
        ...PENDING_DOC,
        fiscalState: 'GENERATED',
      });

      await expect(service.transmit('fd-1')).rejects.toThrow(FiscalTransmissionFailedException);
      expect(prisma.fiscalDocument.updateMany).not.toHaveBeenCalled();
    });

    it('throws FiscalTransmissionFailedException when the document has no xmlPayload', async () => {
      (prisma.fiscalDocument.findUnique as jest.Mock).mockResolvedValue({
        ...PENDING_DOC,
        xmlPayload: null,
      });

      await expect(service.transmit('fd-1')).rejects.toThrow(FiscalTransmissionFailedException);
    });

    it('throws FiscalTransmissionFailedException when the claim affects zero rows (already claimed)', async () => {
      (prisma.fiscalDocument.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(service.transmit('fd-1')).rejects.toThrow(FiscalTransmissionFailedException);
      expect(transmission.signAndSend).not.toHaveBeenCalled();
    });

    it('transitions to REJECTED and throws FiscalDocumentRejectedException on an invalid response', async () => {
      transmission.signAndSend.mockResolvedValue({
        isValid: false,
        xmlDocumentKey: null,
        signedXml: null,
        statusMessage: 'Firma inválida',
        statusCode: '05',
      });

      await expect(service.transmit('fd-1')).rejects.toThrow(FiscalDocumentRejectedException);
      expect(prisma.fiscalDocument.update).toHaveBeenCalledWith({
        where: { id: 'fd-1' },
        data: {
          fiscalState: 'REJECTED',
          ptResponseCode: '05',
          ptResponseMessage: 'Firma inválida',
        },
      });
    });

    it('falls back to a generic message when DIAN returns no status message', async () => {
      transmission.signAndSend.mockResolvedValue({
        isValid: false,
        xmlDocumentKey: null,
        signedXml: null,
        statusMessage: null,
        statusCode: '05',
      });

      await expect(service.transmit('fd-1')).rejects.toThrow(
        'No status message from DIAN',
      );
    });

    it('transitions to SIGNATURE_ERROR when the failure happened before the SDK send', async () => {
      transmission.signAndSend.mockRejectedValue(new Error('certificate could not be loaded'));

      await expect(service.transmit('fd-1')).rejects.toThrow('certificate could not be loaded');
      expect(prisma.fiscalDocument.update).toHaveBeenCalledWith({
        where: { id: 'fd-1' },
        data: {
          fiscalState: 'SIGNATURE_ERROR',
          ptResponseMessage: 'certificate could not be loaded',
        },
      });
    });

    it('leaves the document in IN_TRANSMISSION with retryCount incremented when the outcome is unknown', async () => {
      transmission.signAndSend.mockRejectedValue(new Error('socket timeout after 30s'));

      await expect(service.transmit('fd-1')).rejects.toThrow('socket timeout after 30s');
      expect(prisma.fiscalDocument.update).toHaveBeenCalledWith({
        where: { id: 'fd-1' },
        data: {
          ptResponseMessage: 'socket timeout after 30s',
          retryCount: { increment: 1 },
        },
      });
    });

    it('throws TechProviderConfigNotFoundException when no TechProviderConfig exists', async () => {
      (prisma.techProviderConfig.findFirst as jest.Mock).mockResolvedValue(null);

      const rejection = service.transmit('fd-1');

      await expect(rejection).rejects.toThrow(TechProviderConfigNotFoundException);
      await expect(rejection).rejects.toThrow(
        'No TechProviderConfig found for subscription sub-test',
      );
      await expect(rejection).rejects.toMatchObject({
        errorCode: 'TECH_PROVIDER_CONFIG_NOT_FOUND',
      });
    });

    describe('applyTransmissionResult', () => {
      it('stores the provider track id on VALIDATED without a cufe', async () => {
        await service.applyTransmissionResult('fd-1', {
          isValid: true,
          xmlDocumentKey: null,
          signedXml: null,
          statusCode: '00',
          statusMessage: 'Ok',
        });

        expect(prisma.fiscalDocument.update).toHaveBeenCalledWith({
          where: { id: 'fd-1' },
          data: {
            fiscalState: 'VALIDATED',
            providerTrackId: undefined,
            ptResponseCode: '00',
            ptResponseMessage: 'Ok',
          },
        });
      });

      it('records only the refusal on REJECTED', async () => {
        await service.applyTransmissionResult('fd-1', {
          isValid: false,
          xmlDocumentKey: null,
          signedXml: null,
          statusCode: '05',
          statusMessage: 'Firma inválida',
        });

        expect(prisma.fiscalDocument.update).toHaveBeenCalledWith({
          where: { id: 'fd-1' },
          data: {
            fiscalState: 'REJECTED',
            ptResponseCode: '05',
            ptResponseMessage: 'Firma inválida',
          },
        });
      });
    });
  });
});
