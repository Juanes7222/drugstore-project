// Temporary script to verify enum values.
import 'dotenv/config';
import { PrismaClient } from '../generated/full-client/client.js';

const prisma = new PrismaClient();

async function main() {
  const result: unknown = await prisma.$queryRawUnsafe(
    'SELECT enum_range(NULL::"SyncOperationType")::text as values',
  );
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch((e: Error) => { console.error(e.message); process.exit(1); });
