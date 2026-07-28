import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WompiConfig } from '@pharmacy/shared-types';
import type { EnvConfig } from '../../../config/env.schema';

/**
 * Reads Wompi Colombia configuration from the central env schema.
 *
 * Uses the NestJS ConfigService (backed by env.schema.ts Zod validation)
 * instead of reading process.env directly. All env vars are validated and
 * typed at application startup.
 *
 * Wompi is optional: if keys are not set, isConfigured() returns false and
 * WompiService operations will fail at call time.
 */
@Injectable()
export class WompiConfigService {
  private readonly logger = new Logger(WompiConfigService.name);
  private readonly config: WompiConfig | null = null;

  constructor(configService: ConfigService<EnvConfig, true>) {
    const publicKey = configService.get('WOMPI_PUBLIC_KEY');
    const privateKey = configService.get('WOMPI_PRIVATE_KEY');
    const eventsSecret = configService.get('WOMPI_EVENTS_SECRET');
    const rawEnv = configService.get('WOMPI_ENVIRONMENT');

    if (!publicKey || !privateKey || !eventsSecret) {
      this.logger.warn(
        'Wompi not configured — WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY, or WOMPI_EVENTS_SECRET missing. ' +
        'Subscription payment processing will be unavailable.',
      );
      return;
    }

    this.config = {
      publicKey,
      privateKey,
      eventsSecret,
      environment: rawEnv === 'production' ? 'prod' : 'test',
    };

    this.logger.log(
      `Wompi configured for ${this.config.environment === 'prod' ? 'production' : 'sandbox'} environment`,
    );
  }

  /** Whether all required Wompi keys are present. */
  isConfigured(): boolean {
    return this.config !== null;
  }

  /**
   * Returns the Wompi configuration, throwing if not configured.
   * Callers should check isConfigured() first or catch the error.
   */
  getConfig(): Readonly<WompiConfig> {
    if (!this.config) {
      throw new Error(
        'Wompi is not configured. Set WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY, and WOMPI_EVENTS_SECRET.',
      );
    }
    return this.config;
  }
}
