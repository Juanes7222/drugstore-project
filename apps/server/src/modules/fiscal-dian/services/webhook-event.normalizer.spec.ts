import { FiscalProvider } from '@pharmacy/shared-types';
import { WebhookEventNormalizer } from './webhook-event.normalizer';

describe('WebhookEventNormalizer', () => {
  let normalizer: WebhookEventNormalizer;

  beforeEach(() => {
    normalizer = new WebhookEventNormalizer();
  });

  describe('normalize', () => {
    // Provider-specific payload mapping lands with the provider adapters;
    // until then the intake pipeline records the event as FAILED instead of
    // guessing field names.
    it.each([
      FiscalProvider.DIAN_DIRECT,
      FiscalProvider.ALANUBE,
      FiscalProvider.DATAICO,
    ])('returns null for %s', (provider) => {
      expect(
        normalizer.normalize(provider, { status: 'VALIDATED', cufe: 'x' }),
      ).toBeNull();
    });
  });
});
