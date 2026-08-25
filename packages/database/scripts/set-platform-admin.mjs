// set-platform-admin.mjs — grant or revoke the platform-admin flag.
//
// This is the ONLY sanctioned way to set User.isPlatformAdmin. The flag
// gates the /saas-admin/* surface (cross-tenant access), so it must never
// be assignable through any HTTP endpoint.
//
// Usage:
//   node scripts/set-platform-admin.mjs <identifier> <true|false>
//
//   <identifier>  User id, email, or username
//   <true|false>  Desired flag value
//
// Examples:
//   node scripts/set-platform-admin.mjs owner@drugstore.co true
//   node scripts/set-platform-admin.mjs usr_8f3a... false

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/full-client/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the package-local .env regardless of the caller's working directory.
const envPath = join(__dirname, '..', '.env');
if (!existsSync(envPath)) {
  console.error(`Missing env file: ${envPath} (must define DATABASE_URL)`);
  process.exit(1);
}
for (const line of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
  const match = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/.exec(line);
  if (match && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = match[1];
  }
}

function fail(message) {
  console.error(`Error: ${message}`);
  console.error('Usage: node scripts/set-platform-admin.mjs <identifier> <true|false>');
  process.exit(1);
}

const [identifier, rawFlag] = process.argv.slice(2);
if (!identifier) fail('missing <identifier>');
if (rawFlag !== 'true' && rawFlag !== 'false') {
  fail('<true|false> must be exactly "true" or "false"');
}
const isPlatformAdmin = rawFlag === 'true';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) fail('DATABASE_URL is not set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ id: identifier }, { email: identifier }, { username: identifier }],
    },
    select: { id: true, email: true, username: true, role: true, isPlatformAdmin: true },
  });

  if (!user) {
    console.error(`Error: no user found for identifier "${identifier}"`);
    process.exitCode = 1;
  } else {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { isPlatformAdmin },
      select: { id: true, email: true, role: true, isPlatformAdmin: true },
    });
    console.log(
      `User ${updated.id} (${updated.email ?? updated.username ?? 'no-email'}) ` +
        `role=${updated.role}: isPlatformAdmin=${updated.isPlatformAdmin}`,
    );
    // A user losing the flag must not keep live sessions that already carry
    // the old claim set; sessions re-validate against the DB per request,
    // so this is informational rather than a security step.
    if (!isPlatformAdmin) {
      console.log('Note: existing access tokens expire naturally; the guard reads the flag fresh per request.');
    }
  }
} catch (error) {
  console.error('Error updating user:', error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
