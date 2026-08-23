import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { BullMqModule } from '@/infrastructure/queue/bullmq.module';
import { FiscalDocumentsController } from './controllers/fiscal-documents.controller';
import { FiscalResolutionsController } from './controllers/fiscal-resolutions.controller';
import { FiscalCertificateController } from './controllers/fiscal-certificate.controller';
import { FiscalWebhooksController } from './controllers/fiscal-webhooks.controller';
import { FiscalIssuerConfigController } from './fiscal-issuer-config.controller';
import { TechProviderConfigController } from './tech-provider-config.controller';
import { FiscalResolutionAllocationsController } from './fiscal-resolution-allocations.controller';
import { FiscalDocumentsService } from './services/fiscal-documents.service';
import { FiscalResolutionsService } from './services/fiscal-resolutions.service';
import { FiscalCertificateService } from './services/fiscal-certificate.service';
import { FiscalCertificateCryptoService } from './services/fiscal-certificate-crypto.service';
import { FiscalCertificateParser } from './services/fiscal-certificate.parser';
import { CertificateNitExtractor } from './services/certificate-nit-extractor';
import { FiscalWebhookService } from './services/fiscal-webhook.service';
import { WebhookSignatureVerifier } from './services/webhook-signature.verifier';
import { WebhookEventNormalizer } from './services/webhook-event.normalizer';
import { EnvSecretResolver } from './services/env-secret.resolver';
import { FiscalIssuerConfigService } from './fiscal-issuer-config.service';
import { TechProviderConfigService } from './tech-provider-config.service';
import { FiscalResolutionAllocationsService } from './fiscal-resolution-allocations.service';
import { ResolutionExpirationAlertJob } from './jobs/resolution-expiration-alert.job';
import { FiscalCertificateExpirationJob } from './jobs/fiscal-certificate-expiration.job';

/**
 * Fiscal-DIAN Module
 *
 * Configuration layer: FiscalIssuerConfig, TechProviderConfig,
 * FiscalCertificate, FiscalResolution, FiscalResolutionAllocation,
 * FiscalDocument management, and the inbound webhook intake for external
 * fiscal providers (Alanube, Dataico).
 * The consumer side (document generation/signing/transmission) lives in
 * apps/fiscal-engine.
 */
@Module({
  imports: [PrismaModule, BullMqModule],
  controllers: [
    FiscalDocumentsController,
    FiscalResolutionsController,
    FiscalCertificateController,
    FiscalWebhooksController,
    FiscalIssuerConfigController,
    TechProviderConfigController,
    FiscalResolutionAllocationsController,
  ],
  providers: [
    FiscalDocumentsService,
    FiscalResolutionsService,
    FiscalCertificateService,
    FiscalCertificateCryptoService,
    FiscalCertificateParser,
    CertificateNitExtractor,
    FiscalWebhookService,
    WebhookSignatureVerifier,
    WebhookEventNormalizer,
    EnvSecretResolver,
    FiscalIssuerConfigService,
    TechProviderConfigService,
    FiscalResolutionAllocationsService,
    ResolutionExpirationAlertJob,
    FiscalCertificateExpirationJob,
  ],
  exports: [
    FiscalDocumentsService,
    FiscalResolutionsService,
    FiscalCertificateService,
    FiscalIssuerConfigService,
    TechProviderConfigService,
    FiscalResolutionAllocationsService,
  ],
})
export class FiscalDianModule {}
