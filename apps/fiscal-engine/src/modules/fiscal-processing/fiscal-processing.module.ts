import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FiscalProcessingProcessor } from './fiscal-processing.processor';
import { FiscalDocumentsService } from './fiscal-documents.service';
import { CufeCalculator } from './builders/cufe.calculator';
import { UblInvoiceBuilder } from './builders/ubl-invoice.builder';

@Module({
  imports: [BullModule.registerQueue({ name: 'fiscal-documents' })],
  providers: [
    FiscalProcessingProcessor,
    FiscalDocumentsService,
    CufeCalculator,
    UblInvoiceBuilder,
  ],
})
export class FiscalProcessingModule {}
