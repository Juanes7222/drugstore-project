import { Injectable, Logger } from '@nestjs/common';
import { FiscalProvider } from '@pharmacy/shared-types';

/**
 * Normalized webhook outcome written to FiscalWebhookEvent. apps/server
 * extracts these fields at intake time so apps/fiscal-engine can apply the
 * result without knowing any provider-specific payload shape.
 */
export interface NormalizedWebhookEvent {
  providerEventId: string | null;
  eventType: string | null;
  providerTrackId: string | null;
  outcome: 'VALIDATED' | 'REJECTED' | 'OTHER' | null;
  cufe: string | null;
  signedXml: string | null;
  responseCode: string | null;
  responseMessage: string | null;
}

/**
 * Maps a provider webhook payload to the shared NormalizedWebhookEvent
 * shape. Provider-specific mapping lands with the provider adapters; until
 * then normalize() returns null so the intake pipeline records the event
 * as FAILED instead of guessing field names.
 */
@Injectable()
export class WebhookEventNormalizer {
  private readonly logger = new Logger(WebhookEventNormalizer.name);

  normalize(
    provider: FiscalProvider,
    payload: Record<string, unknown>,
  ): NormalizedWebhookEvent | null {
    switch (provider) {
      case 'DIAN_DIRECT':
        return null;
      case 'ALANUBE':
      case 'DATAICO':
        // TODO(provider-implementation): map the provider's payload fields
        // (status, cufe, xml, track id, event id) into the normalized shape.
        this.logger.warn(
          `Webhook normalization for ${provider} not implemented yet`,
        );
        return null;
      default:
        return null;
    }
  }
}
