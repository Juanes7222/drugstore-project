import { UpsertTechProviderConfigSchema } from './upsert-tech-provider-config.dto';

const BASE_VALID = {
  endpointUrl: 'https://ws.dian.example/api',
  environment: 'HABILITACION',
};

describe('UpsertTechProviderConfigSchema', () => {
  describe('valid inputs', () => {
    it('accepts the minimal shape with providerType defaulting to DIAN_DIRECT', () => {
      const result = UpsertTechProviderConfigSchema.parse(BASE_VALID);

      expect(result.providerType).toBe('DIAN_DIRECT');
      // DIAN's term is normalized to the TipoAmbiente wire literal at rest.
      expect(result.environment).toBe('2');
      expect(result.timeoutSeconds).toBe(30);
      expect(result.credentialReference).toBeUndefined();
      expect(result.webhookSecretReference).toBeUndefined();
    });

    it('accepts explicit providerType and secret references', () => {
      const result = UpsertTechProviderConfigSchema.parse({
        ...BASE_VALID,
        providerType: 'ALANUBE',
        timeoutSeconds: 45,
        credentialReference: 'env:ALANUBE_API_TOKEN',
        webhookSecretReference: 'env:ALANUBE_WEBHOOK_SECRET',
      });

      expect(result.providerType).toBe('ALANUBE');
      expect(result.timeoutSeconds).toBe(45);
      expect(result.credentialReference).toBe('env:ALANUBE_API_TOKEN');
      expect(result.webhookSecretReference).toBe('env:ALANUBE_WEBHOOK_SECRET');
    });

    it('accepts null secret references', () => {
      const result = UpsertTechProviderConfigSchema.parse({
        ...BASE_VALID,
        credentialReference: null,
        webhookSecretReference: null,
      });

      expect(result.credentialReference).toBeNull();
      expect(result.webhookSecretReference).toBeNull();
    });
  });

  describe('environment normalization', () => {
    it.each([
      ['PRODUCCION', '1'],
      ['HABILITACION', '2'],
      ['1', '1'],
      ['2', '2'],
    ])('normalizes %s to the wire literal %s', (input, expected) => {
      const result = UpsertTechProviderConfigSchema.parse({
        ...BASE_VALID,
        environment: input,
      });

      expect(result.environment).toBe(expected);
    });

    it.each(['SANDBOX', 'TEST', '3', 'produccion'])(
      'rejects the unknown environment %s',
      (input) => {
        expect(() =>
          UpsertTechProviderConfigSchema.parse({
            ...BASE_VALID,
            environment: input,
          }),
        ).toThrow();
      },
    );

    // environment is mandatory: there is no safe default between producción
    // and habilitación, so both a missing key and an explicit null must be
    // rejected rather than silently resolved.
    it('rejects a payload without environment', () => {
      expect(() =>
        UpsertTechProviderConfigSchema.parse({
          endpointUrl: BASE_VALID.endpointUrl,
        }),
      ).toThrow();
    });

    it('rejects a null environment', () => {
      expect(() =>
        UpsertTechProviderConfigSchema.parse({
          ...BASE_VALID,
          environment: null,
        }),
      ).toThrow();
    });
  });

  describe('invalid inputs', () => {
    it('rejects a non-URL endpoint', () => {
      expect(() =>
        UpsertTechProviderConfigSchema.parse({
          ...BASE_VALID,
          endpointUrl: 'not-a-url',
        }),
      ).toThrow('Endpoint URL must be a valid URL');
    });

    it('rejects an unknown providerType', () => {
      expect(() =>
        UpsertTechProviderConfigSchema.parse({
          ...BASE_VALID,
          providerType: 'OTRO_PROVEEDOR',
        }),
      ).toThrow();
    });

    it('rejects a credential reference that does not follow store:path', () => {
      expect(() =>
        UpsertTechProviderConfigSchema.parse({
          ...BASE_VALID,
          credentialReference: 'plain-secret-value',
        }),
      ).toThrow('Must follow store:path convention');
    });

    it('rejects a webhook secret reference that does not follow store:path', () => {
      expect(() =>
        UpsertTechProviderConfigSchema.parse({
          ...BASE_VALID,
          webhookSecretReference: 'not a reference',
        }),
      ).toThrow('Must follow store:path convention');
    });

    it('rejects a non-positive timeout', () => {
      expect(() =>
        UpsertTechProviderConfigSchema.parse({
          ...BASE_VALID,
          timeoutSeconds: 0,
        }),
      ).toThrow();
    });
  });
});
