import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { loadInfisicalSecretsIfNeeded } from '@pharmacy/infisical-config';

async function bootstrap(): Promise<void> {
  const logger = new Logger('FiscalEngine');

  // In production, secrets are resolved exclusively from Infisical. In
  // development this is a no-op (the local .env keeps providing secrets).
  const secrets = await loadInfisicalSecretsIfNeeded();
  if (!secrets.skipped) {
    logger.log(`Loaded ${secrets.injectedCount} secrets from Infisical`);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });

  app.enableShutdownHooks();
  logger.log('Fiscal engine started and waiting for jobs');

  const shutdown = (signal: string) => {
    logger.log(`Received ${signal}, shutting down gracefully...`);
    void app.close().then(() => {
      logger.log('Application context closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void bootstrap();
