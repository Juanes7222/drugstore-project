/**
 * CLI entry point that rebuilds the POS e2e server fixture world.
 *
 * Run from apps/server:
 *   npx tsx test/pos-e2e/reset.ts
 *
 * Invoked by apps/pos-desktop/e2e/real-backend.ts before the Tauri app boots
 * and again between specs. Kept as a separate process because the fixture needs
 * the server's TypeScript path aliases and its own dependency graph; the WDIO
 * runner lives in apps/pos-desktop and resolves `@/` to its own source tree.
 *
 * Connects with the OWNER role on purpose. TRUNCATE and the fixture writes do
 * not need a tenant context, and using the owner keeps this script independent
 * of the RLS policies it would otherwise have to satisfy one more time.
 */
import "reflect-metadata";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@pharmacy/database";
import { resetBaseline } from "./baseline";

// Must match docker-compose.test.yml (postgres-test). Deliberately NOT read
// from apps/server/.env, which points at the developer database on 5432.
const TEST_OWNER_DATABASE_URL =
  process.env.POS_E2E_OWNER_DATABASE_URL ??
  "postgresql://pharmacy_test:pharmacy_test@localhost:5433/pharmacy_test_db";

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: TEST_OWNER_DATABASE_URL }),
  });

  try {
    await prisma.$connect();
    await resetBaseline(prisma);
    // eslint-disable-next-line no-console
    console.log("[pos-e2e] server fixture baseline ready");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error("[pos-e2e] fixture reset failed:", error);
  process.exit(1);
});
