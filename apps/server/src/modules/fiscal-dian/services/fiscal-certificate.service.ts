import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { FiscalCertificateCryptoService } from './fiscal-certificate-crypto.service';
import { FiscalCertificateParser } from './fiscal-certificate.parser';
import { CertificateNitExtractor } from './certificate-nit-extractor';
import { FISCAL_ISSUER_CONFIG_ID } from '../constants/fiscal-singleton-ids';
import { UploadFiscalCertificateInput } from '../dto/upload-fiscal-certificate.dto';
import { FiscalCertificateNotFoundException } from '../exceptions/fiscal-certificate-not-found.exception';
import { FiscalCertificateInvalidException } from '../exceptions/fiscal-certificate-invalid.exception';

const MAX_DECODED_CERTIFICATE_BYTES = 3 * 1024 * 1024;

/**
 * Manages the tenant's DIAN digital certificates: validated upload,
 * encrypted-at-rest storage, rotation (a new upload retires the previous
 * ACTIVE certificate) and revocation.
 *
 * The one-ACTIVE-certificate-per-issuer invariant is enforced here in the
 * service — the schema defers the partial unique index to a future
 * migration, so the database does not protect it yet.
 */
@Injectable()
export class FiscalCertificateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly crypto: FiscalCertificateCryptoService,
    private readonly parser: FiscalCertificateParser,
    private readonly nitExtractor: CertificateNitExtractor,
  ) {}

  /**
   * Validates and stores a certificate bundle. The bundle is parsed first
   * (which verifies the password), then encrypted, then persisted. Any
   * previously ACTIVE certificate of the tenant is rotated to ROTATED in
   * the same transaction.
   */
  async upload(
    dto: UploadFiscalCertificateInput,
    uploadedById: string,
  ): Promise<{
    id: string;
    alias: string;
    subjectCn: string;
    validTo: Date;
    status: string;
  }> {
    const p12Buffer = Buffer.from(dto.certificateBase64.trim(), 'base64');
    if (p12Buffer.length === 0) {
      throw new FiscalCertificateInvalidException('bundle is empty');
    }
    if (p12Buffer.length > MAX_DECODED_CERTIFICATE_BYTES) {
      throw new FiscalCertificateInvalidException('bundle exceeds 3 MB');
    }

    let metadata;
    try {
      metadata = this.parser.parseMetadata(p12Buffer, dto.password);
    } catch (error) {
      throw new FiscalCertificateInvalidException(
        error instanceof Error ? error.message : 'parse failed',
      );
    }

    // The certificate must belong to the tenant's configured NIT — a
    // certificate for another taxpayer would sign documents under the wrong
    // identity. Unrecognizable subjects are rejected too, so the system
    // never stores a certificate it cannot verify against the issuer.
    const certificateNit = this.nitExtractor.extract(
      metadata.subjectCn,
      metadata.serialNumber,
    );
    if (!certificateNit) {
      throw new FiscalCertificateInvalidException(
        'subject does not contain a recognizable NIT (expected "NIT 900.123.456-7" or a bare NIT digit string)',
      );
    }

    const issuerConfig = await this.prisma.fiscalIssuerConfig.findUnique({
      where: { id: FISCAL_ISSUER_CONFIG_ID },
      select: { nit: true },
    });
    if (!issuerConfig) {
      throw new FiscalCertificateInvalidException(
        'issuer configuration is not set — configure the tenant NIT before uploading a certificate',
      );
    }
    if (!this.nitExtractor.matches(certificateNit, issuerConfig.nit)) {
      throw new FiscalCertificateInvalidException(
        `certificate belongs to a different NIT (${certificateNit}) than the configured issuer (${issuerConfig.nit.replace(/\D/g, '')})`,
      );
    }

    const { encryptedBundle, keyVersion } = this.crypto.encryptBundle({
      p12Base64: dto.certificateBase64.trim(),
      password: dto.password,
      softwareSecurityCode: dto.softwareSecurityCode,
    });

    const subscriptionId = this.tenantContext.getSubscriptionId();
    const id = randomUUID();

    return this.prisma.withTenant(subscriptionId, async (tx) => {
      await tx.fiscalCertificate.updateMany({
        where: { subscriptionId, status: 'ACTIVE' },
        data: { status: 'ROTATED', rotatedAt: new Date() },
      });

      return tx.fiscalCertificate.create({
        data: {
          id,
          subscriptionId,
          alias: dto.alias,
          subjectCn: metadata.subjectCn,
          issuerCn: metadata.issuerCn,
          serialNumber: metadata.serialNumber,
          validFrom: metadata.validFrom,
          validTo: metadata.validTo,
          encryptedBundle: Uint8Array.from(encryptedBundle),
          keyEncryptionKeyVersion: keyVersion,
          uploadedById,
          activatedAt: new Date(),
        },
        select: {
          id: true,
          alias: true,
          subjectCn: true,
          validTo: true,
          status: true,
        },
      });
    });
  }

  /** Lists certificates without any credential material. */
  async findAll(): Promise<
    Array<{
      id: string;
      alias: string;
      subjectCn: string;
      issuerCn: string;
      validFrom: Date;
      validTo: Date;
      status: string;
      activatedAt: Date | null;
      rotatedAt: Date | null;
    }>
  > {
    return this.prisma.fiscalCertificate.findMany({
      where: { subscriptionId: this.tenantContext.getSubscriptionId() },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        alias: true,
        subjectCn: true,
        issuerCn: true,
        validFrom: true,
        validTo: true,
        status: true,
        activatedAt: true,
        rotatedAt: true,
      },
    });
  }

  async findById(id: string): Promise<{
    id: string;
    alias: string;
    subjectCn: string;
    issuerCn: string;
    serialNumber: string;
    validFrom: Date;
    validTo: Date;
    status: string;
    activatedAt: Date | null;
    rotatedAt: Date | null;
    createdAt: Date;
  }> {
    const certificate = await this.prisma.fiscalCertificate.findFirst({
      where: {
        id,
        subscriptionId: this.tenantContext.getSubscriptionId(),
      },
      select: {
        id: true,
        alias: true,
        subjectCn: true,
        issuerCn: true,
        serialNumber: true,
        validFrom: true,
        validTo: true,
        status: true,
        activatedAt: true,
        rotatedAt: true,
        createdAt: true,
      },
    });
    if (!certificate) {
      throw new FiscalCertificateNotFoundException(id);
    }
    return certificate;
  }

  /** Revokes a certificate. The private key stays encrypted in storage. */
  async revoke(id: string): Promise<{ id: string }> {
    const subscriptionId = this.tenantContext.getSubscriptionId();
    const certificate = await this.prisma.fiscalCertificate.findFirst({
      where: { id, subscriptionId },
      select: { id: true },
    });
    if (!certificate) {
      throw new FiscalCertificateNotFoundException(id);
    }

    return this.prisma.withTenant(subscriptionId, async (tx) => {
      const updated = await tx.fiscalCertificate.update({
        where: { id },
        data: { status: 'REVOKED', rotatedAt: new Date() },
        select: { id: true },
      });
      return updated;
    });
  }
}
