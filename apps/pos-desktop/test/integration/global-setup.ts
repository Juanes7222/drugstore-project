/**
 * Vitest global setup for integration tests.
 *
 * - Starts (or connects to) apps/server
 * - Seeds the test database with default data (admin user, workstation)
 * - Sets `process.env.TEST_SERVER_URL` so tests know where to connect
 * - Sets `process.env.TEST_DATABASE_URL` so the test database helper connects
 *   to the right database
 *
 * ## What gets seeded
 *
 * After this setup runs, the test database contains:
 *
 * - A workstation: `integration-test-ws-001`
 * - An admin user: `admin@pharmacy.test` / `AdminTest123!` (role: ADMIN)
 *
 * Tests can use these well-known credentials to log in and then create
 * more specific users as needed.
 *
 * @vitest-environment node
 */
import { TestServer } from "./harness/test-server";
import { TestDatabase, TEST_IDS } from "./harness/test-database";

/**
 * Global reference so teardown can access the same instance.
 * WARNING: Vitest's globalSetup runs in a separate worker context.
 * We communicate with the test worker via process.env or a temp file.
 */
let server: TestServer;

/**
 * Vitest's globalSetup function.
 * Runs once before ALL test files in the integration suite.
 */
export async function setup(): Promise<void> {
  // 1. Start server
  server = new TestServer({
    startMode: (process.env.TEST_SERVER_START as "auto" | "external" | "spawn") ?? "auto",
  });
  await server.start();

  // 2. Set env vars for test workers
  process.env.TEST_SERVER_URL = server.baseUrl;
  process.env.TEST_WORKSTATION_ID = TEST_IDS.WORKSTATION;

  // 3. Seed database
  const db = new TestDatabase();
  await db.connect();
  try {
    // Clean slate before seeding
    await db.truncateAll();
    await db.seedDefaults();
  } finally {
    await db.close();
  }
}

export async function teardown(): Promise<void> {
  if (server) {
    await server.stop();
  }
}
