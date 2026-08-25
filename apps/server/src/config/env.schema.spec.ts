import {
  envSchema,
  envSchemaWithStoragePolicy,
} from './env.schema';

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

describe('envSchemaWithStoragePolicy', () => {
  const r2Env = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/pharmacy',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    STORAGE_DRIVER: 'r2',
    R2_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com',
    R2_BACKUPS_BUCKET: 'pharmacy-backups',
    R2_BACKUPS_ACCESS_KEY_ID: 'backups-access-key-id',
    R2_BACKUPS_SECRET_ACCESS_KEY: 'backups-secret-access-key',
    R2_UPDATES_BUCKET: 'pharmacy-updates',
    R2_UPDATES_ACCESS_KEY_ID: 'updates-access-key-id',
    R2_UPDATES_SECRET_ACCESS_KEY: 'updates-secret-access-key',
  };

  const localEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/pharmacy',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
  };

  describe('when STORAGE_DRIVER is r2', () => {
    it('should parse successfully when all seven R2 variables are present', () => {
      const result = envSchemaWithStoragePolicy.parse(r2Env);
      expect(result.STORAGE_DRIVER).toBe('r2');
      expect(result.R2_BACKUPS_BUCKET).toBe(r2Env.R2_BACKUPS_BUCKET);
    });

    it('should reject when one R2 variable is missing', () => {
      const { R2_UPDATES_SECRET_ACCESS_KEY: _, ...rest } = r2Env;
      expect(() =>
        envSchemaWithStoragePolicy.parse(rest),
      ).toThrow(/STORAGE_DRIVER=r2 requires/);
    });

    it('should reject when an R2 credential is an empty string', () => {
      expect(() =>
        envSchemaWithStoragePolicy.parse({
          ...r2Env,
          R2_UPDATES_SECRET_ACCESS_KEY: '',
        }),
      ).toThrow();
    });

    it('should reject when an R2 credential is whitespace only', () => {
      expect(() =>
        envSchemaWithStoragePolicy.parse({
          ...r2Env,
          R2_BACKUPS_SECRET_ACCESS_KEY: '   ',
        }),
      ).toThrow(/STORAGE_DRIVER=r2 requires/);
    });

    it('should reject when all R2 variables are empty strings', () => {
      expect(() =>
        envSchemaWithStoragePolicy.parse({
          ...r2Env,
          R2_ENDPOINT: '',
          R2_BACKUPS_BUCKET: '',
          R2_BACKUPS_ACCESS_KEY_ID: '',
          R2_BACKUPS_SECRET_ACCESS_KEY: '',
          R2_UPDATES_BUCKET: '',
          R2_UPDATES_ACCESS_KEY_ID: '',
          R2_UPDATES_SECRET_ACCESS_KEY: '',
        }),
      ).toThrow(/STORAGE_DRIVER=r2 requires/);
    });

    it('should reject when R2 variables are empty or whitespace only', () => {
      expect(() =>
        envSchemaWithStoragePolicy.parse({
          ...r2Env,
          R2_ENDPOINT: '',
          R2_BACKUPS_BUCKET: '   ',
          R2_BACKUPS_ACCESS_KEY_ID: '   ',
          R2_BACKUPS_SECRET_ACCESS_KEY: '   ',
          R2_UPDATES_BUCKET: '   ',
          R2_UPDATES_ACCESS_KEY_ID: '   ',
          R2_UPDATES_SECRET_ACCESS_KEY: '   ',
        }),
      ).toThrow(/STORAGE_DRIVER=r2 requires/);
    });
  });

  describe('when STORAGE_DRIVER is local or omitted', () => {
    it('should apply default STORAGE_DRIVER local when not provided', () => {
      const result = envSchemaWithStoragePolicy.parse(localEnv);
      expect(result.STORAGE_DRIVER).toBe('local');
    });

    it('should parse with explicit local driver and zero R2 variables', () => {
      const result = envSchemaWithStoragePolicy.parse({
        ...localEnv,
        STORAGE_DRIVER: 'local',
      });
      expect(result.STORAGE_DRIVER).toBe('local');
    });

    it('should treat present-but-empty R2 variables as unset with local driver', () => {
      const result = envSchemaWithStoragePolicy.parse({
        ...localEnv,
        R2_ENDPOINT: '',
        R2_BACKUPS_BUCKET: '   ',
        R2_BACKUPS_ACCESS_KEY_ID: '',
        R2_BACKUPS_SECRET_ACCESS_KEY: '',
        R2_UPDATES_BUCKET: '',
        R2_UPDATES_ACCESS_KEY_ID: '',
        R2_UPDATES_SECRET_ACCESS_KEY: '',
      });
      expect(result.R2_ENDPOINT).toBeUndefined();
    });
  });
});
