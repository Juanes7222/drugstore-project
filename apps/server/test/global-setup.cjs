/**
 * Jest globalSetup for the e2e config: provisions the test database schema and
 * builds the CJS bundle of @pharmacy/database (if stale or missing) before any
 * test module loads.
 *
 * The postgres-test container mounts its data directory as tmpfs, so the schema
 * disappears whenever the container is recreated. Without this step the suite
 * only passes on a database that someone migrated by hand, and a fresh clone or
 * a Docker restart fails with "table does not exist".
 */
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const {
  TEST_APP_DATABASE_URL,
  TEST_DATABASE_URL,
} = require('./test-database-url.cjs');

const serverDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(__dirname, '../../..');
const prismaCli = path.join(serverDir, 'node_modules/prisma/build/index.js');
const prismaConfig = path.join(
  repoRoot,
  'packages/database/prisma.full.config.ts',
);

/** Database names that identify an explicitly throwaway e2e database. */
const TEST_DATABASE_NAME_PATTERN = /test/i;

function databaseName(databaseUrl) {
  try {
    return new URL(databaseUrl).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

/**
 * Applies pending migrations so the suite is reproducible from an empty
 * database. Skipped for databases that are not recognisably a test database,
 * to avoid migrating a real one by accident.
 */
function provisionSchema() {
  const databaseUrl = process.env.DATABASE_URL ?? TEST_DATABASE_URL;
  const name = databaseName(databaseUrl);
  if (!TEST_DATABASE_NAME_PATTERN.test(name)) {
    // eslint-disable-next-line no-console
    console.log(
      `[global-setup] skipping migrations: "${name}" is not a test database`,
    );
    return;
  }

  const result = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--config', prismaConfig],
    {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    },
  );

  if (result.status !== 0) {
    throw new Error(
      [
        `[global-setup] prisma migrate deploy failed for "${name}".`,
        'Start the e2e database with: docker compose -f docker-compose.test.yml up -d',
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

function resolveEsbuild() {
  const storeDir = path.join(repoRoot, 'node_modules/.pnpm');
  const dirs = fs
    .readdirSync(storeDir)
    .filter((d) => d.startsWith('esbuild@'))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const candidate = path.join(storeDir, dir, 'node_modules', 'esbuild');
    if (fs.existsSync(candidate)) return require(candidate);
  }
  throw new Error('esbuild not found for database CJS bundler');
}

function bundleIsStale() {
  const outFile = path.join(__dirname, 'generated/database-cjs/database.cjs');
  if (!fs.existsSync(outFile)) return true;
  const outMtime = fs.statSync(outFile).mtimeMs;
  const sources = [
    path.join(repoRoot, 'packages/database/dist/src'),
    path.join(repoRoot, 'packages/database/dist/generated'),
  ];
  for (const dir of sources) {
    if (!fs.existsSync(dir)) return true;
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (
          entry.name.endsWith('.js') &&
          fs.statSync(full).mtimeMs > outMtime
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * esbuild leaves dynamic import() expressions untouched when bundling to CJS,
 * and jest's CJS runtime cannot execute them (no --experimental-vm-modules).
 * The generated client lazily loads its query compiler through dynamic imports
 * of ESM-only files, so those are rewritten to require() of the CJS (.js)
 * equivalents, wrapped so the async callers still see a promise.
 */
function rewriteEsmDynamicImports(code) {
  return code
    .replace(
      'import("node:buffer")',
      'Promise.resolve(require("node:buffer"))',
    )
    .replace(
      'import("@prisma/client/runtime/query_compiler_fast_bg.postgresql.mjs")',
      'Promise.resolve(require("@prisma/client/runtime/query_compiler_fast_bg.postgresql.js"))',
    )
    .replace(
      'import("@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.mjs")',
      'Promise.resolve(require("@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.js"))',
    );
}

function buildDatabaseBundle() {
  const esbuild = resolveEsbuild();
  const entry = path.join(repoRoot, 'packages/database/dist/src/index.js');
  const outDir = path.join(__dirname, 'generated/database-cjs');
  const outFile = path.join(outDir, 'database.cjs');
  fs.mkdirSync(outDir, { recursive: true });
  esbuild.buildSync({
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['@prisma/client', '@prisma/client-runtime-utils'],
    define: {
      'import.meta.url': JSON.stringify(
        require('node:url').pathToFileURL(entry).href,
      ),
    },
    logLevel: 'warning',
  });
  fs.writeFileSync(
    outFile,
    rewriteEsmDynamicImports(fs.readFileSync(outFile, 'utf8')),
  );
  // eslint-disable-next-line no-console
  console.log('[global-setup] database CJS bundle rebuilt');
}

/**
 * The app role is created by the RLS migration without a password, and the
 * Docker image trusts localhost connections, so the harness sets one to keep the
 * app URL explicit and independent of pg_hba. Idempotent.
 */
function ensureAppRoleCanConnect() {
  const password = new URL(TEST_APP_DATABASE_URL).password;
  if (!password) return;

  const sqlFile = path.join(__dirname, 'generated', 'app-role.sql');
  fs.mkdirSync(path.dirname(sqlFile), { recursive: true });
  fs.writeFileSync(
    sqlFile,
    `ALTER ROLE pharmacy_app WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}';\n`,
  );

  const result = spawnSync(
    process.execPath,
    [
      prismaCli,
      'db',
      'execute',
      '--file',
      sqlFile,
      '--config',
      prismaConfig,
    ],
    {
      cwd: serverDir,
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL ?? TEST_DATABASE_URL,
      },
      encoding: 'utf8',
    },
  );

  if (result.status !== 0) {
    throw new Error(
      ['[global-setup] could not grant the app role a password', result.stdout, result.stderr]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

module.exports = async function globalSetup() {
  provisionSchema();
  ensureAppRoleCanConnect();
  if (bundleIsStale()) buildDatabaseBundle();
};
