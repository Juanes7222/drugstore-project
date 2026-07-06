import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('FiscalEngine');

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
