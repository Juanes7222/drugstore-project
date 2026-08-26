// Entrypoint for the migrator container (docker/server.Dockerfile, target
// migrator): resolves secrets through the same Infisical loader the apps use,
// then runs `prisma migrate deploy` against the resolved DATABASE_URL.
import { spawnSync } from 'node:child_process';
import { loadInfisicalSecretsIfNeeded } from '@pharmacy/infisical-config';

const PRISMA_CLI_PATH = '/usr/local/bin/prisma';
const PRISMA_CONFIG_PATH = '/app/prisma.full.config.ts';

const result = await loadInfisicalSecretsIfNeeded();
if (!result.skipped) {
  console.log(`[migrate] Loaded ${result.injectedCount} secrets from Infisical`);
}

const migration = spawnSync(
  PRISMA_CLI_PATH,
  ['migrate', 'deploy', '--config', PRISMA_CONFIG_PATH],
  { stdio: 'inherit', env: process.env },
);

if (migration.error) {
  console.error('[migrate] Failed to launch prisma CLI:', migration.error);
  process.exit(1);
}

process.exit(migration.status ?? 1);
