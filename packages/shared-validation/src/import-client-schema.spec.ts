import { ClientImportRowSchema } from './import-client-schema';

function buildClientRow(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Ana Garcia',
    identificationType: 'CC',
    identificationNumber: '1234567890',
    email: 'ana@email.com',
    ...overrides,
  };
}

describe('ClientImportRowSchema', () => {
  describe('when input is valid', () => {
    it('accepts a minimal required-only row', () => {
      const result = ClientImportRowSchema.parse({
        fullName: 'Ana Garcia',
        identificationType: 'CC',
        identificationNumber: '1234567890',
      });

      expect(result).toEqual(
        expect.objectContaining({
          fullName: 'Ana Garcia',
          identificationType: 'CC',
          identificationNumber: '1234567890',
        }),
      );
      expect(result.email).toBeUndefined();
      expect(result.creditLimit).toBeUndefined();
    });

    it('accepts a complete row with every optional field', () => {
      const result = ClientImportRowSchema.parse(
        buildClientRow({
          phone: '3101234567',
          address: 'Calle 123 #45-67',
          municipality: 'Bogota',
          department: 'Cundinamarca',
          creditLimit: '500000',
        }),
      );

      expect(result.phone).toBe('3101234567');
      expect(result.creditLimit).toBe(500000);
    });

    it('resolves the identificationType alias "cedula" to CC', () => {
      const result = ClientImportRowSchema.parse(
        buildClientRow({ identificationType: 'cedula' }),
      );

      expect(result.identificationType).toBe('CC');
    });

    it('resolves the identificationType alias "cedula de ciudadania" to CC', () => {
      const result = ClientImportRowSchema.parse(
        buildClientRow({ identificationType: 'cedula de ciudadania' }),
      );

      expect(result.identificationType).toBe('CC');
    });

    it('resolves the identificationType alias "tarjeta de identidad" to TI', () => {
      const result = ClientImportRowSchema.parse(
        buildClientRow({ identificationType: 'tarjeta de identidad' }),
      );

      expect(result.identificationType).toBe('TI');
    });

    it('resolves the identificationType alias "pasaporte" to PASSPORT', () => {
      const result = ClientImportRowSchema.parse(
        buildClientRow({ identificationType: 'pasaporte' }),
      );

      expect(result.identificationType).toBe('PASSPORT');
    });

    it('resolves the identificationType alias "nit" to NIT', () => {
      const result = ClientImportRowSchema.parse(
        buildClientRow({ identificationType: 'nit' }),
      );

      expect(result.identificationType).toBe('NIT');
    });

    it('accepts a raw enum value for identificationType without aliasing', () => {
      const result = ClientImportRowSchema.parse(
        buildClientRow({ identificationType: 'PEP' }),
      );

      expect(result.identificationType).toBe('PEP');
    });
  });

  describe('when input is invalid', () => {
    it('rejects a row without fullName', () => {
      const result = ClientImportRowSchema.safeParse(
        buildClientRow({ fullName: '' }),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['fullName']);
      }
    });

    it('rejects a row without identificationNumber', () => {
      const result = ClientImportRowSchema.safeParse(
        buildClientRow({ identificationNumber: '' }),
      );

      expect(result.success).toBe(false);
    });

    it('rejects an identificationNumber longer than 20 characters', () => {
      const result = ClientImportRowSchema.safeParse(
        buildClientRow({ identificationNumber: '1'.repeat(21) }),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['identificationNumber']);
      }
    });

    it('rejects an unknown identificationType', () => {
      const result = ClientImportRowSchema.safeParse(
        buildClientRow({ identificationType: 'XX' }),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['identificationType']);
      }
    });

    it('rejects an invalid email', () => {
      const result = ClientImportRowSchema.safeParse(
        buildClientRow({ email: 'not-an-email' }),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['email']);
      }
    });

    it('rejects a negative creditLimit', () => {
      const result = ClientImportRowSchema.safeParse(
        buildClientRow({ creditLimit: '-5' }),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['creditLimit']);
      }
    });
  });
});