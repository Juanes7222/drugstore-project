import {
  loadInfisicalSecretsIfNeeded,
  loadSecretsFromInfisical,
} from './index';

jest.mock('@infisical/sdk', () => ({
  InfisicalSDK: jest.fn().mockImplementation(() => {
    // Create the inner mocks once per client instance so the same functions
    // are used by both the loader and the test assertions.
    const login = jest.fn().mockResolvedValue(undefined);
    const listSecrets = jest.fn().mockResolvedValue({
      secrets: [
        { secretKey: 'DATABASE_URL', secretValue: 'postgresql://infisical' },
        { secretKey: 'JWT_ACCESS_SECRET', secretValue: 's3cr3t' },
        { secretKey: 'INFISICAL_PROJECT_ID', secretValue: 'must-not-override' },
      ],
    });
    return {
      auth: () => ({ universalAuth: { login } }),
      secrets: () => ({ listSecrets }),
    };
  }),
}));

const { InfisicalSDK } = jest.requireMock('@infisical/sdk') as {
  InfisicalSDK: jest.Mock;
};

const ENV_KEYS = [
  'NODE_ENV',
  'INFISICAL_ENABLED',
  'INFISICAL_CLIENT_ID',
  'INFISICAL_CLIENT_SECRET',
  'INFISICAL_PROJECT_ID',
  'INFISICAL_ENVIRONMENT',
  'INFISICAL_SITE_URL',
  'INFISICAL_SECRET_PATH',
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
];

const originalValues: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ENV_KEYS) {
    originalValues[key] = process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalValues[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValues[key];
    }
  }
  InfisicalSDK.mockClear();
});

describe('loadInfisicalSecretsIfNeeded', () => {
  it('skips in development unless forced', async () => {
    process.env.NODE_ENV = 'development';

    const result = await loadInfisicalSecretsIfNeeded();

    expect(result).toEqual({ skipped: true, injectedCount: 0 });
    expect(InfisicalSDK).not.toHaveBeenCalled();
  });

  it('throws in production when Machine Identity credentials are missing', async () => {
    process.env.NODE_ENV = 'production';

    await expect(loadInfisicalSecretsIfNeeded()).rejects.toThrow(
      /INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET, INFISICAL_PROJECT_ID/,
    );
  });

  it('throws when forced in development without credentials', async () => {
    process.env.NODE_ENV = 'development';
    process.env.INFISICAL_ENABLED = 'true';

    await expect(loadInfisicalSecretsIfNeeded()).rejects.toThrow(
      /INFISICAL_CLIENT_SECRET/,
    );
  });

  it('loads secrets in production from the prod environment', async () => {
    process.env.NODE_ENV = 'production';
    process.env.INFISICAL_CLIENT_ID = 'cid';
    process.env.INFISICAL_CLIENT_SECRET = 'csec';
    process.env.INFISICAL_PROJECT_ID = 'pid';

    const result = await loadInfisicalSecretsIfNeeded();

    expect(result).toEqual({ skipped: false, injectedCount: 2 });
    expect(process.env.DATABASE_URL).toBe('postgresql://infisical');
    expect(process.env.INFISICAL_PROJECT_ID).toBe('pid');

    const client = InfisicalSDK.mock.results[0].value;
    expect(client.auth().universalAuth.login).toHaveBeenCalledWith({
      clientId: 'cid',
      clientSecret: 'csec',
    });
    expect(client.secrets().listSecrets).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'prod',
        projectId: 'pid',
        secretPath: '/',
        expandSecretReferences: true,
        includeImports: true,
      }),
    );
  });

  it('loads secrets in development when forced, from the dev environment', async () => {
    process.env.NODE_ENV = 'development';
    process.env.INFISICAL_ENABLED = 'true';
    process.env.INFISICAL_CLIENT_ID = 'cid';
    process.env.INFISICAL_CLIENT_SECRET = 'csec';
    process.env.INFISICAL_PROJECT_ID = 'pid';

    const result = await loadInfisicalSecretsIfNeeded();

    expect(result.skipped).toBe(false);
    const client = InfisicalSDK.mock.results[0].value;
    expect(client.secrets().listSecrets).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'dev' }),
    );
  });
});

describe('loadSecretsFromInfisical', () => {
  it('injects secrets into process.env and skips INFISICAL bootstrap keys', async () => {
    const result = await loadSecretsFromInfisical({
      clientId: 'cid',
      clientSecret: 'csec',
      projectId: 'pid',
      environment: 'prod',
    });

    expect(result).toEqual({ skipped: false, injectedCount: 2 });
    expect(process.env.DATABASE_URL).toBe('postgresql://infisical');
    expect(process.env.JWT_ACCESS_SECRET).toBe('s3cr3t');
    expect(process.env.INFISICAL_PROJECT_ID).toBeUndefined();
  });

  it('passes siteUrl and secretPath through to the client', async () => {
    await loadSecretsFromInfisical({
      clientId: 'cid',
      clientSecret: 'csec',
      projectId: 'pid',
      environment: 'prod',
      siteUrl: 'https://infisical.example.com',
      secretPath: '/server',
    });

    expect(InfisicalSDK).toHaveBeenCalledWith({
      siteUrl: 'https://infisical.example.com',
    });
    const client = InfisicalSDK.mock.results[0].value;
    expect(client.secrets().listSecrets).toHaveBeenCalledWith(
      expect.objectContaining({ secretPath: '/server' }),
    );
  });
});
