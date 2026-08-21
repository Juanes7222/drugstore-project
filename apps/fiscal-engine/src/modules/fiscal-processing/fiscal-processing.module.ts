import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FiscalProcessingProcessor } from './fiscal-processing.processor';
import { FiscalWebhookProcessor } from './fiscal-webhook.processor';
import { FiscalDocumentsService } from './fiscal-documents.service';
import { FiscalTransmissionService } from './fiscal-transmission.service';
import { ContingencyResultWriter } from './contingency-result.writer';
import { CufeCalculator } from './builders/cufe.calculator';
import { UblInvoiceBuilder } from './builders/ubl-invoice.builder';
import {
  FISCAL_TRANSMISSION_PORT,
  SECRET_READER_PORT,
} from './ports';
import { SoapFiscalTransmissionAdapter } from './adapters/soap-fiscal-transmission.adapter';
import { DbCertificateSecretReaderAdapter } from './adapters/db-certificate-secret-reader.adapter';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'fiscal-documents' }),
    BullModule.registerQueue({ name: 'fiscal-webhook-events' }),
  ],
  providers: [
    FiscalProcessingProcessor,
    FiscalWebhookProcessor,
    FiscalDocumentsService,
    FiscalTransmissionService,
    ContingencyResultWriter,
    CufeCalculator,
    UblInvoiceBuilder,
    {
      provide: FISCAL_TRANSMISSION_PORT,
      useClass: SoapFiscalTransmissionAdapter,
    },
    {
      provide: SECRET_READER_PORT,
      useClass: DbCertificateSecretReaderAdapter,
    },
  ],
})
export class FiscalProcessingModule {}