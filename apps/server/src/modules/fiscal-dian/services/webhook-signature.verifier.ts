import { Injectable, Logger } from '@nestjs/common';
import { FiscalProvider } from '@pharmacy/shared-types';
import { EnvSecretResolver } from './env-secret.resolver';

export interface WebhookSignatureContext {
  provider: FiscalProvider;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  webhookSecret: string;
}

/**
 * Verifies the authenticity of inbound fiscal-provider webhooks.
 *
 * Signature schemes are provider-specific and are finalised during the
 * provider implementation phase (see the per-provider TODO comments).
 * Until a provider's scheme is implemented, its webhooks are rejected —
 * an unverifiable webhook must never mutate a fiscal document.
 */
@Injectable()
export class WebhookSignatureVerifier {
  private readonly logger = new Logger(WebhookSignatureVerifier.name);

  constructor(private readonly secrets: EnvSecretResolver) {}

  verify(context: WebhookSignatureContext): boolean {
    switch (context.provider) {
      case 'DIAN_DIRECT':
        // The direct path has no webhooks at all.
        return false;
      case 'ALANUBE':
        // TODO(provider-implementation): Alanube signs webhooks with an
        // HMAC-SHA256 over the raw body (header name to confirm against
        // their docs during the Alanube adapter work).
        this.logger.warn(
          'Alanube webhook signature verification not implemented yet',
        );
        return false;
      case 'DATAICO':
        // TODO(provider-implementation): confirm whether Dataico signs
        // webhooks and with which header/algorithm before accepting them.
        this.logger.warn(
          'Dataico webhook signature verification not implemented yet',
        );
        return false;
      default:
        return false;
    }
  }
}
