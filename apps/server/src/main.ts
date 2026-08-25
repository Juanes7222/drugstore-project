import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { loadInfisicalSecretsIfNeeded } from '@pharmacy/infisical-config';
import { TenantContextInterceptor } from './modules/tenant/tenant-context.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ZodExceptionFilter } from './common/filters/zod-exception.filter';
import { EnvConfig } from './config/env.schema';

// Fix BigInt serialization in JSON responses
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  // In production, secrets are resolved exclusively from Infisical. In
  // development this is a no-op (the local .env keeps providing secrets).
  const secrets = await loadInfisicalSecretsIfNeeded();
  if (!secrets.skipped) {
    console.log(`Loaded ${secrets.injectedCount} secrets from Infisical`);
  }

  const app = await NestFactory.create(AppModule);
  // Production sits behind a single nginx hop; trusting exactly that proxy
  // makes req.ip (and therefore rate limiting) see real client addresses.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  const configService = app.get(ConfigService<EnvConfig>);

  // CORS_ORIGIN accepts one origin or a comma-separated list; the default
  // covers the local dev frontends (backoffice and its strictPort sibling).
  const corsOriginEnv: string = configService.get(
    'CORS_ORIGIN',
    'http://localhost:5173,http://localhost:5174',
  );
  const corsOrigins = corsOriginEnv
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'X-Backup-Id',
      'X-Backup-Created-At',
      'X-Backup-Sha256',
      'x-offline-token',
    ],
    credentials: true,
  });

  app.use(helmet() as any);
  app.use(compression() as any);

  // Raw-body capture for webhook HMAC verification (fiscal-dian providers)
  // plus a larger limit for base64 certificate uploads. The buffer is only
  // kept on the request object; response bodies are unaffected.
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter(), new ZodExceptionFilter());
  app.useGlobalInterceptors(app.get(TenantContextInterceptor));

  // Global ValidationPipe with transform enables the `@Type(() => Number)`
  // decorators in query DTOs to convert string query params to numbers.
  // We intentionally do NOT enable enableImplicitConversion to avoid
  // class-transformer's surprising boolean coercion (": false" → true).
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  // Swagger is a documentation surface, not a production feature; keep it off
  // unless explicitly enabled (SWAGGER_ENABLED=true) in a non-dev environment.
  const swaggerEnabled =
    configService.get('NODE_ENV') !== 'production' ||
    process.env.SWAGGER_ENABLED === 'true';

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Pharmacy POS API')
      .setDescription('Local-first pharmacy POS system for Colombian regulatory context')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();

    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, swaggerDocument);
  }

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
