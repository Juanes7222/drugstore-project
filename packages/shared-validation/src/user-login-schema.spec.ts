import { UserLoginSchema } from './user-login-schema';

describe('UserLoginSchema', () => {
  describe('when input is valid', () => {
    it('should accept a valid username and password', () => {
      const result = UserLoginSchema.parse({
        username: 'admin',
        password: 'secret123',
      });
      expect(result.username).toBe('admin');
      expect(result.password).toBe('secret123');
    });
  });

  describe('when username is invalid', () => {
    it('should reject empty username', () => {
      expect(() =>
        UserLoginSchema.parse({
          username: '',
          password: 'secret123',
        }),
      ).toThrow();
    });
  });

  describe('when password is invalid', () => {
    it('should reject password shorter than 8 characters', () => {
      expect(() =>
        UserLoginSchema.parse({
          username: 'admin',
          password: '1234567',
        }),
      ).toThrow();
    });

    it('should reject empty password', () => {
      expect(() =>
        UserLoginSchema.parse({
          username: 'admin',
          password: '',
        }),
      ).toThrow();
    });

    it('should accept password exactly 8 characters', () => {
      const result = UserLoginSchema.parse({
        username: 'admin',
        password: '12345678',
      });
      expect(result.password).toBe('12345678');
    });
  });

  describe('when fields are missing', () => {
    it('should reject missing username', () => {
      expect(() =>
        UserLoginSchema.parse({ password: 'secret123' }),
      ).toThrow();
    });

    it('should reject missing password', () => {
      expect(() =>
        UserLoginSchema.parse({ username: 'admin' }),
      ).toThrow();
    });

    it('should reject empty object', () => {
      expect(() => UserLoginSchema.parse({})).toThrow();
    });
  });
});
