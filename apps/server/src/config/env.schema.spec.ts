import { envSchema } from './env.schema';

describe('envSchema', () => {
  const fullEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/pharmacy',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    JWT_ACCESS_TTL_SECONDS: '900',
    JWT_REFRESH_TTL_SECONDS: '604800',
    PORT: '3000',
    NODE_ENV: 'development',
    REDIS_URL: 'redis://localhost:6379',
  };

  describe('when all variables are present and valid', () => {
    it('should parse successfully', () => {
      const result = envSchema.parse(fullEnv);
      expect(result.DATABASE_URL).toBe(fullEnv.DATABASE_URL);
      expect(result.PORT).toBe(3000);
      expect(result.NODE_ENV).toBe('development');
    });
  });

  describe('when required variables are missing', () => {
    it('should reject missing DATABASE_URL', () => {
      const { DATABASE_URL: _, ...rest } = fullEnv;
      expect(() => envSchema.parse(rest)).toThrow();
    });

    it('should reject missing JWT_ACCESS_SECRET', () => {
      const { JWT_ACCESS_SECRET: _, ...rest } = fullEnv;
      expect(() => envSchema.parse(rest)).toThrow();
    });

    it('should reject missing JWT_REFRESH_SECRET', () => {
      const { JWT_REFRESH_SECRET: _, ...rest } = fullEnv;
      expect(() => envSchema.parse(rest)).toThrow();
    });
  });

  describe('when JWT secrets are too short', () => {
    it('should reject JWT_ACCESS_SECRET shorter than 32 chars', () => {
      expect(() =>
        envSchema.parse({
          ...fullEnv,
          JWT_ACCESS_SECRET: 'short',
        }),
      ).toThrow();
    });
  });

  describe('when NODE_ENV is invalid', () => {
    it('should reject invalid NODE_ENV', () => {
      expect(() =>
        envSchema.parse({
          ...fullEnv,
          NODE_ENV: 'invalid',
        }),
      ).toThrow();
    });
  });

  describe('when PORT is invalid', () => {
    it('should reject non-numeric PORT', () => {
      expect(() =>
        envSchema.parse({
          ...fullEnv,
          PORT: 'abc',
        }),
      ).toThrow();
    });

    it('should reject PORT of 0', () => {
      expect(() =>
        envSchema.parse({
          ...fullEnv,
          PORT: '0',
        }),
      ).toThrow();
    });
  });

  describe('when defaults apply', () => {
    it('should apply default PORT when not provided', () => {
      const { PORT: _, ...rest } = fullEnv;
      const result = envSchema.parse(rest);
      expect(result.PORT).toBe(3000);
    });

    it('should apply default NODE_ENV when not provided', () => {
      const { NODE_ENV: _, ...rest } = fullEnv;
      const result = envSchema.parse(rest);
      expect(result.NODE_ENV).toBe('development');
    });

    it('should apply default REDIS_URL when not provided', () => {
      const { REDIS_URL: _, ...rest } = fullEnv;
      const result = envSchema.parse(rest);
      expect(result.REDIS_URL).toBe('redis://localhost:6379');
    });
  });

  describe('when DATABASE_URL is invalid', () => {
    it('should reject non-URL string', () => {
      expect(() =>
        envSchema.parse({
          ...fullEnv,
          DATABASE_URL: 'not-a-url',
        }),
      ).toThrow();
    });
  });
});
