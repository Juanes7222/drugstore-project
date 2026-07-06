import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { BullMqModule } from '@/infrastructure/queue/bullmq.module';
import { FiscalDocumentsController } from './controllers/fiscal-documents.controller';
import { FiscalResolutionsController } from './controllers/fiscal-resolutions.controller';
import { FiscalIssuerConfigController } from './fiscal-issuer-config.controller';
import { TechProviderConfigController } from './tech-provider-config.controller';
import { FiscalResolutionAllocationsController } from './fiscal-resolution-allocations.controller';
import { FiscalDocumentsService } from './services/fiscal-documents.service';
import { FiscalResolutionsService } from './services/fiscal-resolutions.service';
import { FiscalIssuerConfigService } from './fiscal-issuer-config.service';
import { TechProviderConfigService } from './tech-provider-config.service';
import { FiscalResolutionAllocationsService } from './fiscal-resolution-allocations.service';
import { ResolutionExpirationAlertJob } from './jobs/resolution-expiration-alert.job';

/**
 * Fiscal-DIAN Module
 *
 * Configuration layer: FiscalIssuerConfig, TechProviderConfig, FiscalResolution,
 * FiscalResolutionAllocation, and FiscalDocument management.
 * The consumer side (document generation/signing/transmission) lives in
 * apps/fiscal-engine.
 */
@Module({
  imports: [PrismaModule, BullMqModule],
  controllers: [
    FiscalDocumentsController,
    FiscalResolutionsController,
    FiscalIssuerConfigController,
    TechProviderConfigController,
    FiscalResolutionAllocationsController,
  ],
  providers: [
    FiscalDocumentsService,
    FiscalResolutionsService,
    FiscalIssuerConfigService,
    TechProviderConfigService,
    FiscalResolutionAllocationsService,
    ResolutionExpirationAlertJob,
  ],
  exports: [
    FiscalDocumentsService,
    FiscalResolutionsService,
    FiscalIssuerConfigService,
    TechProviderConfigService,
    FiscalResolutionAllocationsService,
  ],
})
export class FiscalDianModule {}
