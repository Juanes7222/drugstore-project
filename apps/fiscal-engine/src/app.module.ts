import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { BullMqModule } from './infrastructure/queue/bullmq.module';
import { FiscalProcessingModule } from './modules/fiscal-processing/fiscal-processing.module';
import { envSchema } from './config/env.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      validate: (config) => envSchema.parse(config),
      isGlobal: true,
    }),
    PrismaModule,
    BullMqModule,
    FiscalProcessingModule,
  ],
})
export class AppModule {}
