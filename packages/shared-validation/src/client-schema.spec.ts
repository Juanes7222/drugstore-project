import { ClientSchema } from './client-schema';

describe('ClientSchema', () => {
  const validClient = {
    firstName: 'Juan',
    lastName: 'Pérez',
    identificationType: 'CC' as const,
    identificationNumber: '1234567890',
    email: 'juan@email.com',
    phone: '3101234567',
    address: 'Calle 123 #45-67',
  };

  describe('when input is valid', () => {
    it('should accept a complete client', () => {
      const result = ClientSchema.parse(validClient);
      expect(result.firstName).toBe('Juan');
      expect(result.identificationNumber).toBe('1234567890');
    });

    it('should accept client without optional fields', () => {
      const result = ClientSchema.parse({
        firstName: 'Ana',
        lastName: 'García',
        identificationType: 'CC',
        identificationNumber: '9876543210',
      });
      expect(result.email).toBeUndefined();
      expect(result.firstName).toBe('Ana');
    });
  });

  describe('when identificationType is invalid', () => {
    it('should reject unknown identification type', () => {
      expect(() =>
        ClientSchema.parse({
          ...validClient,
          identificationType: 'XX',
        }),
      ).toThrow();
    });
  });

  describe('when firstName is invalid', () => {
    it('should reject empty firstName', () => {
      expect(() =>
        ClientSchema.parse({ ...validClient, firstName: '' }),
      ).toThrow();
    });

    it('should reject firstName exceeding 100 characters', () => {
      expect(() =>
        ClientSchema.parse({ ...validClient, firstName: 'x'.repeat(101) }),
      ).toThrow();
    });
  });

  describe('when lastName is invalid', () => {
    it('should reject empty lastName', () => {
      expect(() =>
        ClientSchema.parse({ ...validClient, lastName: '' }),
      ).toThrow();
    });
  });

  describe('when identificationNumber is invalid', () => {
    it('should reject empty identificationNumber', () => {
      expect(() =>
        ClientSchema.parse({ ...validClient, identificationNumber: '' }),
      ).toThrow();
    });

    it('should reject identificationNumber exceeding 20 characters', () => {
      expect(() =>
        ClientSchema.parse({
          ...validClient,
          identificationNumber: '1'.repeat(21),
        }),
      ).toThrow();
    });
  });

  describe('when email is invalid', () => {
    it('should reject invalid email format', () => {
      expect(() =>
        ClientSchema.parse({
          ...validClient,
          email: 'notanemail',
        }),
      ).toThrow();
    });
  });

  describe('when phone is too long', () => {
    it('should reject phone exceeding 20 characters', () => {
      expect(() =>
        ClientSchema.parse({
          ...validClient,
          phone: 'x'.repeat(21),
        }),
      ).toThrow();
    });
  });
});
