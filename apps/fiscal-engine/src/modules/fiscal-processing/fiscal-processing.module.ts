import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FiscalProcessingProcessor } from './fiscal-processing.processor';
import { FiscalDocumentsService } from './fiscal-documents.service';
import { FiscalTransmissionService } from './fiscal-transmission.service';
import { CufeCalculator } from './builders/cufe.calculator';
import { UblInvoiceBuilder } from './builders/ubl-invoice.builder';
import {
  FISCAL_TRANSMISSION_PORT,
  SECRET_READER_PORT,
} from './ports';
import { DianSdkFiscalTransmissionAdapter } from './adapters/dian-sdk-fiscal-transmission.adapter';
import { FileSystemSecretReaderAdapter } from './adapters/file-system-secret-reader.adapter';

@Module({
  imports: [BullModule.registerQueue({ name: 'fiscal-documents' })],
  providers: [
    FiscalProcessingProcessor,
    FiscalDocumentsService,
    FiscalTransmissionService,
    CufeCalculator,
    UblInvoiceBuilder,
    {
      provide: FISCAL_TRANSMISSION_PORT,
      useClass: DianSdkFiscalTransmissionAdapter,
    },
    {
      provide: SECRET_READER_PORT,
      useClass: FileSystemSecretReaderAdapter,
    },
  ],
})
export class FiscalProcessingModule {}
