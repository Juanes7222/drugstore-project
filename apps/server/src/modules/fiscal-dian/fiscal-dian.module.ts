import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { FiscalDocumentsController } from './controllers/fiscal-documents.controller';
import { FiscalResolutionsController } from './controllers/fiscal-resolutions.controller';
import { FiscalDocumentsService } from './services/fiscal-documents.service';
import { FiscalResolutionsService } from './services/fiscal-resolutions.service';

/**
 * Fiscal-DIAN Module
 *
 * Deferred to logic phase (not scaffolded in this phase):
 * - FiscalIssuerConfig: Establishment DIAN configuration (singleton)
 * - TechProviderConfig: Technology provider credentials
 * - FiscalResolutionAllocation: Resolution number range allocation with row-locking logic
 *
 * Note: No BullMQ producer wiring is included in this phase. Event publishing toward
 * apps/fiscal-engine is real business logic and belongs to the module's logic phase.
 */
@Module({
  imports: [PrismaModule],
  controllers: [FiscalDocumentsController, FiscalResolutionsController],
  providers: [FiscalDocumentsService, FiscalResolutionsService],
  exports: [FiscalDocumentsService, FiscalResolutionsService],
})
export class FiscalDianModule {}
