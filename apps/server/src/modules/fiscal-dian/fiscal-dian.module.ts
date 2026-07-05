import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { FiscalDocumentsController } from './controllers/fiscal-documents.controller';
import { FiscalResolutionsController } from './controllers/fiscal-resolutions.controller';
import { FiscalIssuerConfigController } from './fiscal-issuer-config.controller';
import { TechProviderConfigController } from './tech-provider-config.controller';
import { FiscalDocumentsService } from './services/fiscal-documents.service';
import { FiscalResolutionsService } from './services/fiscal-resolutions.service';
import { FiscalIssuerConfigService } from './fiscal-issuer-config.service';
import { TechProviderConfigService } from './tech-provider-config.service';
import { ResolutionExpirationAlertJob } from './jobs/resolution-expiration-alert.job';

/**
 * Fiscal-DIAN Module
 *
 * Configuration layer: FiscalIssuerConfig, TechProviderConfig, and FiscalResolution
 * management. Document generation, signing, and transmission are deferred to a
 * later phase once this configuration exists for it to consume.
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    FiscalDocumentsController,
    FiscalResolutionsController,
    FiscalIssuerConfigController,
    TechProviderConfigController,
  ],
  providers: [
    FiscalDocumentsService,
    FiscalResolutionsService,
    FiscalIssuerConfigService,
    TechProviderConfigService,
    ResolutionExpirationAlertJob,
  ],
  exports: [
    FiscalDocumentsService,
    FiscalResolutionsService,
    FiscalIssuerConfigService,
    TechProviderConfigService,
  ],
})
export class FiscalDianModule {}
