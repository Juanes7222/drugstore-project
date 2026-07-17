import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { EnvConfig } from './config/env.schema';

// Fix BigInt serialization in JSON responses
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<EnvConfig>);

  app.enableCors({
    origin: configService.get('CORS_ORIGIN', 'http://localhost:5173'),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
  });

  app.use(helmet() as any);
  app.use(compression() as any);

  app.useGlobalFilters(new HttpExceptionFilter());

  // Global ValidationPipe with transform enables the `@Type(() => Number)`
  // decorators in query DTOs to convert string query params to numbers.
  // We intentionally do NOT enable enableImplicitConversion to avoid
  // class-transformer's surprising boolean coercion (": false" → true).
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Pharmacy POS API')
    .setDescription('Local-first pharmacy POS system for Colombian regulatory context')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  const port = configService.get('PORT', 3000);

  await app.listen(port);

  process.on('SIGTERM', async () => {
    await app.close();
  });

  process.on('SIGINT', async () => {
    await app.close();
  });

  console.log(`Server running on port ${port}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
