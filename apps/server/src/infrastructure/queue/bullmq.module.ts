import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

/**
 * Registers the BullMQ root connection and the fiscal-documents queue
 * used by the producer side (FiscalDocumentsService) in apps/server.
 * The consumer side lives in apps/fiscal-engine.
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
  ],
  exports: [BullModule],
})
export class BullMqModule {}
