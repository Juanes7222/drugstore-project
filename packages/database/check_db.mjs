import { PrismaClient } from './dist/src/full.js';

const pc = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});
try {
  const tables = await pc.$queryRawUnsafe(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  console.log('Tables count:', tables.length);
  console.log('Tables:', tables.map(t => t.table_name).join(', '));

  const countResult = await pc.$queryRawUnsafe(
    "SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = 'public'"
  );
  console.log('Count result:', countResult);
} catch (e) {
  console.error('Error:', e.message);
} finally {
  await pc.$disconnect();
}
