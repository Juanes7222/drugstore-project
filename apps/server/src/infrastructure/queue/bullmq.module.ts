import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

/**
 * Registers the BullMQ root connection and the queues used by apps/server:
 * - fiscal-documents: producer side (FiscalDocumentsService); the consumer
 *   lives in apps/fiscal-engine.
 * - fiscal-webhook-events: producer side (FiscalWebhookService); the
 *   consumer lives in apps/fiscal-engine.
 * - imports: data-import module — enqueue + in-process worker both live in
 *   this app (DataImportProcessingJob).
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('REDIS_URL') },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: 'fiscal-documents' }),
    BullModule.registerQueue({ name: 'fiscal-webhook-events' }),
    BullModule.registerQueue({ name: 'imports' }),
  ],
  exports: [BullModule],
})
export class BullMqModule {}
