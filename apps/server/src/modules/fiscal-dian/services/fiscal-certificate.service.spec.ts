// The service's import chain pulls in PrismaService, which value-imports the
// generated Prisma client — the real client must not load under jest.
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import * as forge from 'node-forge';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { FiscalCertificateService } from './fiscal-certificate.service';
import { FiscalCertificateParser } from './fiscal-certificate.parser';
import { FiscalCertificateCryptoService } from './fiscal-certificate-crypto.service';
import { CertificateNitExtractor } from './certificate-nit-extractor';
import { FISCAL_CERTIFICATE_KEK_ENV } from './fiscal-certificate-crypto.service';
import { FiscalCertificateInvalidException } from '../exceptions/fiscal-certificate-invalid.exception';
import { FiscalCertificateNotFoundException } from '../exceptions/fiscal-certificate-not-found.exception';
import { FISCAL_ISSUER_CONFIG_ID } from '../constants/fiscal-singleton-ids';
import { FiscalCertificateStatus } from '@pharmacy/shared-types';

const SOFTWARE_SECURITY_CODE =
  'abcdef0123456789abcdef0123456789abcdef0123456789ab';

// The issuer NIT the tenant has configured; the dummy certificate below
// carries the same NIT in its subject CN.
const ISSUER_NIT = '900123456';

// Dummy self-signed test certificate generated with node-forge itself —
// never a real DIAN certificate (see project testing rules). The subject CN
// embeds a fake NIT so the upload NIT-vs-issuer check can run.
function createDummyP12Base64(
  password: string,
  subjectCn = 'FARMACIA DEMO TEST - NIT 900.123.456-7',
): string {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(2026, 0, 1);
  cert.validity.notAfter = new Date(2036, 0, 1);
  const attrs = [{ name: 'commonName', value: subjectCn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: '3des',
  });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary').toString(
    'base64',
  );
}

const P12_BASE64 = createDummyP12Base64('test-password');
const CERTIFICATE_CN = 'FARMACIA DEMO TEST - NIT 900.123.456-7';

const VALID_UPLOAD = {
  alias: 'DIAN Firma 2026',
  certificateBase64: P12_BASE64,
  password: 'test-password',
  softwareSecurityCode: SOFTWARE_SECURITY_CODE,
};

describe('FiscalCertificateService', () => {
  let service: FiscalCertificateService;
  let prisma: DeepMockProxy<PrismaClient>;
  let tenantContext: { getSubscriptionId: jest.Mock };

  beforeEach(() => {
    process.env[FISCAL_CERTIFICATE_KEK_ENV] = Buffer.alloc(32, 1).toString(
      'base64',
    );
    prisma = mockDeep<PrismaClient>();
    (prisma as any).withTenant = jest.fn(
      async (_subscriptionId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
    );
    tenantContext = { getSubscriptionId: jest.fn().mockReturnValue('sub-1') };
    service = new FiscalCertificateService(
      prisma as any,
      tenantContext as any,
      new FiscalCertificateCryptoService(),
      new FiscalCertificateParser(),
      new CertificateNitExtractor(),
    );
  });

  afterEach(() => {
    delete process.env[FISCAL_CERTIFICATE_KEK_ENV];
  });

  describe('upload', () => {
    it('rotates existing ACTIVE certificates and creates the new ACTIVE row', async () => {
      (prisma.fiscalIssuerConfig.findUnique as jest.Mock).mockResolvedValue({
        nit: ISSUER_NIT,
      });
      (prisma.fiscalCertificate.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (prisma.fiscalCertificate.create as jest.Mock).mockResolvedValue({
        id: 'cert-1',
        alias: 'DIAN Firma 2026',
        subjectCn: CERTIFICATE_CN,
        validTo: new Date(2036, 0, 1),
        status: 'ACTIVE',
      });

      const result = await service.upload(VALID_UPLOAD, 'user-1');

      expect(prisma.fiscalIssuerConfig.findUnique).toHaveBeenCalledWith({
        where: { id: FISCAL_ISSUER_CONFIG_ID },
        select: { nit: true },
      });
      expect(prisma.fiscalCertificate.updateMany).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-1', status: 'ACTIVE' },
        data: { status: 'ROTATED', rotatedAt: expect.any(Date) },
      });
      expect(prisma.fiscalCertificate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.any(String),
          subscriptionId: 'sub-1',
          alias: 'DIAN Firma 2026',
          subjectCn: CERTIFICATE_CN,
          issuerCn: CERTIFICATE_CN,
          serialNumber: '01',
          validFrom: new Date(2026, 0, 1),
          validTo: new Date(2036, 0, 1),
          // Credential material never leaves the bundle — encrypted at rest.
          encryptedBundle: expect.any(Uint8Array),
          keyEncryptionKeyVersion: 'v1',
          uploadedById: 'user-1',
          activatedAt: expect.any(Date),
        }),
        select: {
          id: true,
          alias: true,
          subjectCn: true,
          validTo: true,
          status: true,
        },
      });
      expect(result).toEqual({
        id: 'cert-1',
        alias: 'DIAN Firma 2026',
        subjectCn: CERTIFICATE_CN,
        validTo: new Date(2036, 0, 1),
        status: 'ACTIVE',
      });
    });

    it('rejects a certificate whose subject carries no recognizable NIT', async () => {
      const noNitBundle = createDummyP12Base64('test-password', 'FARMACIA DEMO TEST');
      const promise = service.upload(
        { ...VALID_UPLOAD, certificateBase64: noNitBundle },
        'user-1',
      );

      await expect(promise).rejects.toThrow(FiscalCertificateInvalidException);
      await expect(promise).rejects.toThrow('subject does not contain a recognizable NIT');
      expect(prisma.fiscalCertificate.create).not.toHaveBeenCalled();
    });

    it('rejects when the issuer configuration is not set', async () => {
      (prisma.fiscalIssuerConfig.findUnique as jest.Mock).mockResolvedValue(null);

      const promise = service.upload(VALID_UPLOAD, 'user-1');

      await expect(promise).rejects.toThrow(FiscalCertificateInvalidException);
      await expect(promise).rejects.toThrow('issuer configuration is not set');
      expect(prisma.fiscalCertificate.create).not.toHaveBeenCalled();
    });

    it('rejects when the certificate NIT differs from the configured issuer NIT', async () => {
      (prisma.fiscalIssuerConfig.findUnique as jest.Mock).mockResolvedValue({
        nit: '800197268',
      });

      const promise = service.upload(VALID_UPLOAD, 'user-1');

      await expect(promise).rejects.toThrow(FiscalCertificateInvalidException);
      await expect(promise).rejects.toThrow('belongs to a different NIT');
      expect(prisma.fiscalCertificate.create).not.toHaveBeenCalled();
    });

    it('accepts a certificate NIT that carries the verification digit when the issuer config does not', async () => {
      (prisma.fiscalIssuerConfig.findUnique as jest.Mock).mockResolvedValue({
        nit: '900123456',
      });
      // Bare digit-string subject with DV, no "NIT" label.
      const dvBundle = createDummyP12Base64('test-password', '900.123.456-7');
      (prisma.fiscalCertificate.updateMany as jest.Mock).mockResolvedValue({
        count: 0,
      });
      (prisma.fiscalCertificate.create as jest.Mock).mockResolvedValue({
        id: 'cert-1',
        alias: 'DIAN Firma 2026',
        subjectCn: '900.123.456-7',
        validTo: new Date(2036, 0, 1),
        status: 'ACTIVE',
      });

      await service.upload(
        { ...VALID_UPLOAD, certificateBase64: dvBundle },
        'user-1',
      );

      expect(prisma.fiscalCertificate.create).toHaveBeenCalled();
    });

    it('throws FiscalCertificateInvalidException for an invalid p12 bundle', async () => {
      const promise = service.upload(
        { ...VALID_UPLOAD, certificateBase64: 'bm90IGEgcDEy' },
        'user-1',
      );

      await expect(promise).rejects.toThrow(FiscalCertificateInvalidException);
      expect(prisma.fiscalCertificate.create).not.toHaveBeenCalled();
    });

    it('throws FiscalCertificateInvalidException for a wrong password', async () => {
      const promise = service.upload(
        { ...VALID_UPLOAD, password: 'wrong-password' },
        'user-1',
      );

      await expect(promise).rejects.toThrow(FiscalCertificateInvalidException);
      await expect(promise).rejects.toThrow(
        'Certificate password is incorrect',
      );
    });

    it('throws FiscalCertificateInvalidException for an empty bundle', async () => {
      const promise = service.upload(
        { ...VALID_UPLOAD, certificateBase64: '   ' },
        'user-1',
      );

      await expect(promise).rejects.toThrow('bundle is empty');
    });
  });

  describe('findAll', () => {
    it('lists certificates without the encrypted bundle', async () => {
      (prisma.fiscalCertificate.findMany as jest.Mock).mockResolvedValue([
        { id: 'cert-1', alias: 'DIAN Firma 2026' },
      ]);

      const result = await service.findAll();

      expect(prisma.fiscalCertificate.findMany).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-1' },
        orderBy: { createdAt: 'desc' },
        select: expect.not.objectContaining({
          encryptedBundle: expect.anything(),
        }),
      });
      expect(result).toEqual([{ id: 'cert-1', alias: 'DIAN Firma 2026' }]);
    });
  });

  describe('findById', () => {
    it('returns the certificate when it belongs to the tenant', async () => {
      (prisma.fiscalCertificate.findFirst as jest.Mock).mockResolvedValue({
        id: 'cert-1',
        alias: 'DIAN Firma 2026',
      });

      const result = await service.findById('cert-1');

      expect(prisma.fiscalCertificate.findFirst).toHaveBeenCalledWith({
        where: { id: 'cert-1', subscriptionId: 'sub-1' },
        select: expect.anything(),
      });
      expect(result).toEqual({ id: 'cert-1', alias: 'DIAN Firma 2026' });
    });

    it('throws FiscalCertificateNotFoundException for a missing or other-tenant id', async () => {
      (prisma.fiscalCertificate.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findById('cert-other-tenant')).rejects.toThrow(
        FiscalCertificateNotFoundException,
      );
    });
  });

  describe('revoke', () => {
    it('sets REVOKED with rotatedAt for a tenant certificate', async () => {
      (prisma.fiscalCertificate.findFirst as jest.Mock).mockResolvedValue({
        id: 'cert-1',
      });
      (prisma.fiscalCertificate.update as jest.Mock).mockResolvedValue({
        id: 'cert-1',
      });

      const result = await service.revoke('cert-1');

      expect(prisma.fiscalCertificate.update).toHaveBeenCalledWith({
        where: { id: 'cert-1' },
        data: { status: 'REVOKED', rotatedAt: expect.any(Date) },
        select: { id: true },
      });
      expect(result).toEqual({ id: 'cert-1' });
    });

    it('throws FiscalCertificateNotFoundException for a missing certificate', async () => {
      (prisma.fiscalCertificate.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.revoke('cert-missing')).rejects.toThrow(
        FiscalCertificateNotFoundException,
      );
      expect(prisma.fiscalCertificate.update).not.toHaveBeenCalled();
    });
  });

  describe('hasActiveCertificate', () => {
    it('returns true when the tenant has a certificate in ACTIVE status', async () => {
      (prisma.fiscalCertificate.findFirst as jest.Mock).mockResolvedValue({
        id: 'cert-1',
      });

      const result = await service.hasActiveCertificate();

      // The status filter is what excludes EXPIRED/REVOKED/ROTATED rows.
      expect(prisma.fiscalCertificate.findFirst).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-1', status: FiscalCertificateStatus.ACTIVE },
        select: { id: true },
      });
      expect(result).toBe(true);
    });

    it('returns false when no ACTIVE-status row matches (expired, revoked, rotated or none)', async () => {
      (prisma.fiscalCertificate.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.hasActiveCertificate();

      expect(result).toBe(false);
    });
  });
});
