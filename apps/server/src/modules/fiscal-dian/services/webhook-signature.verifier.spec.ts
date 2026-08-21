import { FiscalProvider } from '@pharmacy/shared-types';
import { WebhookSignatureVerifier } from './webhook-signature.verifier';
import { EnvSecretResolver } from './env-secret.resolver';

describe('WebhookSignatureVerifier', () => {
  let verifier: WebhookSignatureVerifier;

  beforeEach(() => {
    verifier = new WebhookSignatureVerifier({} as EnvSecretResolver);
  });

  describe('verify', () => {
    // No provider signature scheme is implemented yet — until the provider
    // adapters land, every webhook must be rejected: an unverifiable webhook
    // must never mutate a fiscal document.
    it.each([
      FiscalProvider.DIAN_DIRECT,
      FiscalProvider.ALANUBE,
      FiscalProvider.DATAICO,
    ])('returns false for %s', (provider) => {
      const result = verifier.verify({
        provider,
        rawBody: Buffer.from('{"status":"VALIDATED"}'),
        headers: {},
        webhookSecret: 'secret',
      });

      expect(result).toBe(false);
    });
  });
});
