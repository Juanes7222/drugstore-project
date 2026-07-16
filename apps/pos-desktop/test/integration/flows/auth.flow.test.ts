/**
 * Auth integration flow: create user + login.
 *
 * These tests verify the complete auth cycle against the real apps/server:
 *
 * 1. Login as a pre-seeded admin user
 * 2. Create a cashier via POST /users
 * 3. Login as the new cashier
 * 4. Verify the cashier's token works (GET /auth/me)
 * 5. Verify the cashier can't create another user (role enforcement)
 * 6. Login with invalid credentials returns 401
 *
 * ## Why this matters
 *
 * Unit tests mock the HTTP layer and can't catch:
 * - Schema/contract drift between the POS client and server API
 * - Authentication guard wiring issues
 * - Password hashing algorithm changes
 * - Role-based access control regressions
 *
 * These integration tests use the real server endpoints, real database, and
 * real password hashing — exactly what runs in production.
 *
 * @vitest-environment node
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { TestClient } from "../harness/test-client";
import { TestDatabase, TEST_IDS } from "../harness/test-database";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SERVER_URL = process.env.TEST_SERVER_URL ?? "http://localhost:3001";
const WORKSTATION_ID = process.env.TEST_WORKSTATION_ID ?? TEST_IDS.WORKSTATION;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Auth flow: create user + login", () => {
  const client = new TestClient(SERVER_URL, WORKSTATION_ID);
  let db: TestDatabase;

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();
  });

  afterAll(async () => {
    client.clearToken();
    if (db) {
      // NOTE: we do NOT call truncateAll here because globalSetup already
      // truncates all tables at the start of the test run, and other test
      // files (running with isolate: false) depend on the seeded admin user
      // persisting across the suite.  Individual data cleanup is handled by
      // each test file's own cleanup logic.
      await db.close();
    }
  });

  // -----------------------------------------------------------------------
  // Health check — server is reachable
  // -----------------------------------------------------------------------

  it("server is reachable (health check)", async () => {
    const health = await client.health();
    expect(health.reachable).toBe(true);
    // Any HTTP response (even 404) confirms the server is listening
    expect(health.statusCode).toBeGreaterThanOrEqual(100);
  });

  // -----------------------------------------------------------------------
  // Login as admin
  // -----------------------------------------------------------------------

  it("logs in as the seeded admin user and receives tokens", async () => {
    const loginRes = await client.login(
      TEST_IDS.ADMIN_USERNAME,
      TEST_IDS.ADMIN_PASSWORD,
    );

    expect(loginRes).toHaveProperty("accessToken");
    expect(loginRes).toHaveProperty("refreshToken");
    expect(loginRes).toHaveProperty("expiresAt");
    expect(loginRes).toHaveProperty("user");
    expect(loginRes.user.username).toBe(TEST_IDS.ADMIN_USERNAME);
    expect(loginRes.user.role).toBe(TEST_IDS.ADMIN_ROLE);

    // Verify the token works by calling /auth/me
    const me = await client.me();
    expect(me.id).toBe(loginRes.user.id);
    expect(me.username).toBe(TEST_IDS.ADMIN_USERNAME);
  });

  // -----------------------------------------------------------------------
  // Create a cashier user
  // -----------------------------------------------------------------------

  it("creates a cashier user via POST /users", async () => {
    const newUser = await client.createUser({
      displayName: "Test Cashier",
      username: "cashier-integration-test",
      role: "CASHIER",
      initialPassword: "CashierTest123!",
    });

    expect(newUser).toHaveProperty("id");
    expect(newUser.displayName).toBe("Test Cashier");
    expect(newUser.username).toBe("cashier-integration-test");
    expect(newUser.role).toBe("CASHIER");

    // Verify the user exists in the database
    const dbUser = await db.findUserByUsername("cashier-integration-test");
    expect(dbUser).not.toBeNull();
    expect(dbUser!.id).toBe(newUser.id);
    expect(dbUser!.role).toBe("CASHIER");
    expect(dbUser!.isActive).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Login as the new cashier
  // -----------------------------------------------------------------------

  it("logs in as the newly created cashier", async () => {
    // Clear the admin token
    client.clearToken();

    const loginRes = await client.login(
      "cashier-integration-test",
      "CashierTest123!",
    );

    expect(loginRes).toHaveProperty("accessToken");
    expect(loginRes.user.username).toBe("cashier-integration-test");
    expect(loginRes.user.role).toBe("CASHIER");

    // Verify the cashier token works
    const me = await client.me();
    expect(me.username).toBe("cashier-integration-test");
    expect(me.role).toBe("CASHIER");
  });

  // -----------------------------------------------------------------------
  // Role enforcement — cashier can't create users
  // -----------------------------------------------------------------------

  it("rejects user creation by a CASHIER (role enforcement)", async () => {
    // Still logged in as cashier from previous test

    await expect(
      client.createUser({
        displayName: "Should Fail",
        role: "CASHIER",
      }),
    ).rejects.toThrow(/403|Forbidden|insufficient/i);
  });

  // -----------------------------------------------------------------------
  // Invalid credentials
  // -----------------------------------------------------------------------

  it("returns 401 for invalid credentials", async () => {
    client.clearToken();

    await expect(
      client.login(TEST_IDS.ADMIN_USERNAME, "WrongPassword!"),
    ).rejects.toThrow(/401|Unauthorized|unauthorized/i);
  });

  it("returns 401 for non-existent user", async () => {
    client.clearToken();

    await expect(
      client.login("noone@pharmacy.test", "SomePassword1!"),
    ).rejects.toThrow(/401|Unauthorized|unauthorized/i);
  });
});
