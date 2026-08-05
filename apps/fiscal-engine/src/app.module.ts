import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { BullMqModule } from './infrastructure/queue/bullmq.module';
import { FiscalProcessingModule } from './modules/fiscal-processing/fiscal-processing.module';
import { envSchema } from './config/env.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      // In production, secrets can only come from Infisical (injected into
      // process.env by loadInfisicalSecretsIfNeeded in main.ts) — never from
      // a local .env file.
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      validate: (config) => envSchema.parse(config),
      isGlobal: true,
    }),
    PrismaModule,
    BullMqModule,
    FiscalProcessingModule,
  ],
})
export class AppModule {}
