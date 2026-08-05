import { config as loadDotenvConfig } from 'dotenv';
import { InfisicalSDK } from '@infisical/sdk';

/**
 * Environment variables used to bootstrap the Infisical client itself.
 * These are never overridden by secrets fetched from Infisical, otherwise the
 * loader would overwrite the credentials it is currently using.
 */
const INFISICAL_BOOTSTRAP_KEYS = new Set([
  'INFISICAL_CLIENT_ID',
  'INFISICAL_CLIENT_SECRET',
  'INFISICAL_PROJECT_ID',
  'INFISICAL_ENVIRONMENT',
  'INFISICAL_SITE_URL',
  'INFISICAL_SECRET_PATH',
  'INFISICAL_ENABLED',
]);

export interface LoadSecretsFromInfisicalOptions {
  /** Machine Identity client ID (Universal Auth). */
  clientId: string;
  /** Machine Identity client secret (Universal Auth). */
  clientSecret: string;
  /** Infisical project (workspace) ID that holds the secrets. */
  projectId: string;
  /** Infisical environment slug to read secrets from, e.g. 'dev' or 'prod'. */
  environment: string;
  /** Self-hosted Infisical instance URL. Defaults to https://app.infisical.com. */
  siteUrl?: string;
  /** Folder within the environment to read secrets from. Defaults to '/'. */
  secretPath?: string;
}

export interface LoadSecretsResult {
  /** True when the loader intentionally did nothing (non-production, not forced). */
  skipped: boolean;
  /** Number of secrets injected into process.env. */
  injectedCount: number;
}

/**
 * Authenticates against Infisical and injects every secret of the requested
 * environment into process.env. Infisical values win over pre-existing
 * environment variables, except for the INFISICAL_* bootstrap credentials.
 */
export async function loadSecretsFromInfisical(
  options: LoadSecretsFromInfisicalOptions,
): Promise<LoadSecretsResult> {
  const client = new InfisicalSDK(
    options.siteUrl ? { siteUrl: options.siteUrl } : undefined,
  );

  await client.auth().universalAuth.login({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
  });

  const { secrets } = await client.secrets().listSecrets({
    environment: options.environment,
    projectId: options.projectId,
    secretPath: options.secretPath ?? '/',
    expandSecretReferences: true,
    includeImports: true,
  });

  let injectedCount = 0;
  for (const secret of secrets) {
    if (INFISICAL_BOOTSTRAP_KEYS.has(secret.secretKey)) {
      continue;
    }
    process.env[secret.secretKey] = secret.secretValue;
    injectedCount += 1;
  }

  return { skipped: false, injectedCount };
}

/**
 * Loads secrets from Infisical following the environment policy:
 * - Production: secrets can ONLY come from Infisical. Missing Machine Identity
 *   credentials abort the process; there is no fallback to a local .env file.
 * - Development/test: the local .env remains the source of truth and Infisical
 *   is never contacted. Set INFISICAL_ENABLED=true (plus the INFISICAL_*
 *   credentials) to exercise the integration locally against the 'dev'
 *   environment.
 *
 * The Infisical environment defaults to 'prod' in production and 'dev'
 * otherwise; override it with INFISICAL_ENVIRONMENT.
 */
export async function loadInfisicalSecretsIfNeeded(): Promise<LoadSecretsResult> {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';

  if (!isProduction) {
    // In dev/test the Nest ConfigModule loads .env too late for the loader, so
    // read it here to allow INFISICAL_* to be provided in the local .env file.
    loadDotenvConfig({ quiet: true });
  }

  const forced = process.env.INFISICAL_ENABLED === 'true';
  if (!isProduction && !forced) {
    return { skipped: true, injectedCount: 0 };
  }

  const missingCredentials = [
    'INFISICAL_CLIENT_ID',
    'INFISICAL_CLIENT_SECRET',
    'INFISICAL_PROJECT_ID',
  ].filter((key) => !process.env[key]);

  if (missingCredentials.length > 0) {
    throw new Error(
      `Infisical secrets loader requires ${missingCredentials.join(', ')}. ` +
        (isProduction
          ? 'In production, secrets can only be resolved from Infisical — provide the Machine Identity credentials through the deployment environment.'
          : 'Provide them in the local .env and set INFISICAL_ENABLED=true to exercise the integration locally.'),
    );
  }

  return loadSecretsFromInfisical({
    clientId: process.env.INFISICAL_CLIENT_ID!,
    clientSecret: process.env.INFISICAL_CLIENT_SECRET!,
    projectId: process.env.INFISICAL_PROJECT_ID!,
    environment: process.env.INFISICAL_ENVIRONMENT ?? (isProduction ? 'prod' : 'dev'),
    siteUrl: process.env.INFISICAL_SITE_URL,
    secretPath: process.env.INFISICAL_SECRET_PATH,
  });
}
