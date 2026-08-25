import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FiscalProcessingProcessor } from './fiscal-processing.processor';
import { FiscalWebhookProcessor } from './fiscal-webhook.processor';
import { NumberingRangeProcessor } from './numbering-range.processor';
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
import { FileSystemSecretReaderAdapter } from './adapters/file-system-secret-reader.adapter';
import { RoutedSecretReaderAdapter } from './adapters/routed-secret-reader.adapter';
import { TransmissionRouteResolver } from './transmission-route.resolver';
import { FISCAL_DIAN_QUERIES_QUEUE } from '@pharmacy/shared-types';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'fiscal-documents' }),
    BullModule.registerQueue({ name: 'fiscal-webhook-events' }),
    BullModule.registerQueue({
      name: FISCAL_DIAN_QUERIES_QUEUE,
    }),
  ],
  providers: [
    FiscalProcessingProcessor,
    FiscalWebhookProcessor,
    NumberingRangeProcessor,
    FiscalDocumentsService,
    FiscalTransmissionService,
    ContingencyResultWriter,
    CufeCalculator,
    UblInvoiceBuilder,
    TransmissionRouteResolver,
    DbCertificateSecretReaderAdapter,
    FileSystemSecretReaderAdapter,
    {
      provide: FISCAL_TRANSMISSION_PORT,
      useClass: SoapFiscalTransmissionAdapter,
    },
    {
      provide: SECRET_READER_PORT,
      useClass: RoutedSecretReaderAdapter,
    },
  ],
})
export class FiscalProcessingModule {}