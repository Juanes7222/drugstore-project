import { UserLoginSchema } from './user-login-schema';

describe('UserLoginSchema', () => {
  describe('when input is valid', () => {
    it('should accept a valid email and password', () => {
      const result = UserLoginSchema.parse({
        email: 'admin@farmacia.com',
        password: 'secret123',
      });
      expect(result.email).toBe('admin@farmacia.com');
      expect(result.password).toBe('secret123');
    });
  });

  describe('when email is invalid', () => {
    it('should reject missing @ symbol', () => {
      expect(() =>
        UserLoginSchema.parse({
          email: 'notanemail',
          password: 'secret123',
        }),
      ).toThrow();
    });

    it('should reject empty email', () => {
      expect(() =>
        UserLoginSchema.parse({
          email: '',
          password: 'secret123',
        }),
      ).toThrow();
    });
  });

  describe('when password is invalid', () => {
    it('should reject password shorter than 8 characters', () => {
      expect(() =>
        UserLoginSchema.parse({
          email: 'admin@farmacia.com',
          password: '1234567',
        }),
      ).toThrow();
    });

    it('should reject empty password', () => {
      expect(() =>
        UserLoginSchema.parse({
          email: 'admin@farmacia.com',
          password: '',
        }),
      ).toThrow();
    });

    it('should accept password exactly 8 characters', () => {
      const result = UserLoginSchema.parse({
        email: 'admin@farmacia.com',
        password: '12345678',
      });
      expect(result.password).toBe('12345678');
    });
  });

  describe('when fields are missing', () => {
    it('should reject missing email', () => {
      expect(() =>
        UserLoginSchema.parse({ password: 'secret123' }),
      ).toThrow();
    });

    it('should reject missing password', () => {
      expect(() =>
        UserLoginSchema.parse({ email: 'admin@farmacia.com' }),
      ).toThrow();
    });

    it('should reject empty object', () => {
      expect(() => UserLoginSchema.parse({})).toThrow();
    });
  });
});
