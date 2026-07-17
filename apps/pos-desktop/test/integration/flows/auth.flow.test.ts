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
  // List users
  // -----------------------------------------------------------------------

  it("lists users as admin (OWNER) and finds the admin in the list", async () => {
    // Re-login as admin
    client.clearToken();
    await client.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);

    const result = await client.listUsers();
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.users).toBeInstanceOf(Array);

    // The admin user should be in the list
    const adminInList = result.users.find(
      (u: Record<string, unknown>) => u.username === TEST_IDS.ADMIN_USERNAME,
    );
    expect(adminInList).toBeDefined();
    expect(adminInList!.role).toBe(TEST_IDS.ADMIN_ROLE);
  });

  it("lists users with role filter — only CASHIER users returned", async () => {
    // The cashier was created in a previous test
    const result = await client.listUsers({ role: "CASHIER" });

    expect(result.total).toBeGreaterThanOrEqual(1);
    for (const u of result.users) {
      expect(u.role).toBe("CASHIER");
    }

    // Verify the specific cashier is in the filtered list
    const cashierInList = result.users.find(
      (u: Record<string, unknown>) => u.username === "cashier-integration-test",
    );
    expect(cashierInList).toBeDefined();
    expect(cashierInList!.displayName).toBe("Test Cashier");
  });

  it("lists users with status filter", async () => {
    // All users we create are ACTIVE
    const result = await client.listUsers({ status: "ACTIVE" });

    expect(result.total).toBeGreaterThanOrEqual(1);
    for (const u of result.users) {
      expect(u.status).toBe("ACTIVE");
    }
  });

  it("returns empty list when no users match the filter", async () => {
    // SAAS_ADMIN is a valid RoleType that no test user should have
    const result = await client.listUsers({ role: "SAAS_ADMIN" });

    expect(result.total).toBe(0);
    expect(result.users).toHaveLength(0);
  });

  it("rejects listing users by CASHIER (role enforcement)", async () => {
    // Log in as cashier
    client.clearToken();
    await client.login("cashier-integration-test", "CashierTest123!");

    await expect(client.listUsers()).rejects.toThrow(/403|Forbidden|insufficient/i);
  });

  it("lists the admin user with correct details", async () => {
    // Re-login as admin
    client.clearToken();
    await client.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);

    const result = await client.listUsers();
    expect(result.total).toBeGreaterThanOrEqual(1);

    const adminInList = result.users.find(
      (u: Record<string, unknown>) => u.username === TEST_IDS.ADMIN_USERNAME,
    );
    expect(adminInList).toBeDefined();

    // Verify the returned shape matches what the POS desktop expects
    expect(adminInList).toHaveProperty("id");
    expect(adminInList).toHaveProperty("displayName");
    expect(adminInList).toHaveProperty("role");
    expect(adminInList).toHaveProperty("status");
    expect(adminInList).toHaveProperty("isActive");
    expect(adminInList).toHaveProperty("authMethod");
    expect(adminInList).toHaveProperty("createdAt");
  });

  // -----------------------------------------------------------------------
  // Update user (PATCH /users/:id)
  // -----------------------------------------------------------------------

  it("updates a user's displayName", async () => {
    // Re-login as admin
    client.clearToken();
    await client.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);

    // Find the cashier user from DB
    const dbUser = await db.findUserByUsername("cashier-integration-test");
    expect(dbUser).not.toBeNull();
    const cashierId = dbUser!.id;

    const updated = await client.updateUser(cashierId, {
      displayName: "Updated Cashier Name",
    });

    expect(updated.displayName).toBe("Updated Cashier Name");

    // Verify via DB
    const refreshed = await db.findUserById(cashierId);
    expect(refreshed?.displayName).toBe("Updated Cashier Name");
  });

  it("updates a user's role", async () => {
    const updated = await client.updateUser(
      (await db.findUserByUsername("cashier-integration-test"))!.id,
      { role: "MANAGER" },
    );

    expect(updated.role).toBe("MANAGER");

    // Reset role back to CASHIER for subsequent tests
    await client.updateUser(
      (await db.findUserByUsername("cashier-integration-test"))!.id,
      { role: "CASHIER" },
    );
  });

  it("disables a user via POST /users/:id/disable", async () => {
    const cashierId = (await db.findUserByUsername("cashier-integration-test"))!.id;

    const result = await client.disableUser(cashierId);
    expect(result.message).toBe("User disabled");

    // Verify via DB
    const dbUser = await db.findUserById(cashierId);
    expect(dbUser?.isActive).toBe(false);
    expect(dbUser?.status).toBe("DISABLED");
  });

  it("disabled user cannot log in", async () => {
    client.clearToken();

    await expect(
      client.login("cashier-integration-test", "CashierTest123!"),
    ).rejects.toThrow(/401|Unauthorized|disabled|inactive/i);
  });

  it("enables a disabled user via POST /users/:id/enable", async () => {
    // Re-login as admin
    client.clearToken();
    await client.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);

    const cashierId = (await db.findUserByUsername("cashier-integration-test"))!.id;

    const result = await client.enableUser(cashierId);
    expect(result.message).toBe("User enabled");

    // Verify via DB
    const dbUser = await db.findUserById(cashierId);
    expect(dbUser?.isActive).toBe(true);
    expect(dbUser?.status).toBe("ACTIVE");
  });

  it("enabled user can log in again", async () => {
    client.clearToken();

    const loginRes = await client.login(
      "cashier-integration-test",
      "CashierTest123!",
    );
    expect(loginRes.user.role).toBe("CASHIER");
  });

  it("rejects disabling a non-existent user (404)", async () => {
    client.clearToken();
    await client.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);

    await expect(
      client.disableUser("00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(/404|Not Found/i);
  });

  it("rejects updating a user by CASHIER (role enforcement)", async () => {
    client.clearToken();
    await client.login("cashier-integration-test", "CashierTest123!");

    await expect(
      client.updateUser("some-user-id", { displayName: "Hacker" }),
    ).rejects.toThrow(/403|Forbidden|insufficient/i);
  });

  // -----------------------------------------------------------------------
  // Unlock user (POST /users/:id/unlock)
  // -----------------------------------------------------------------------

  it("unlocks a user via POST /users/:id/unlock", async () => {
    client.clearToken();
    await client.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);

    const cashierId = (await db.findUserByUsername("cashier-integration-test"))!.id;

    const result = await client.unlockUser(cashierId);
    expect(result.message).toBe("Account unlocked");

    // Verify via DB
    const dbUser = await db.findUserById(cashierId);
    expect(dbUser?.failedLoginAttempts).toBe(0);
    expect(dbUser?.lockedUntil).toBeNull();
  });

  it("rejects unlocking a non-existent user (404)", async () => {
    await expect(
      client.unlockUser("00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(/404|Not Found/i);
  });

  // -----------------------------------------------------------------------
  // Reset PIN (POST /users/:id/reset-pin)
  // -----------------------------------------------------------------------

  let _newPin: string = "";

  it("resets a user's PIN and returns the new PIN", async () => {
    // Re-login as admin
    client.clearToken();
    await client.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);

    const cashierId = (await db.findUserByUsername("cashier-integration-test"))!.id;

    const result = await client.resetUserPin(cashierId);
    expect(result).toHaveProperty("newPin");
    expect(result.newPin).toMatch(/^\d{4,6}$/); // PIN is 4-6 digits
    expect(result.message).toContain("PIN");

    _newPin = result.newPin;
  });

  it("logs in with the new PIN", async () => {
    client.clearToken();
    expect(_newPin).toBeTruthy();

    const loginRes = await client.login(
      "cashier-integration-test",
      _newPin,
      "PIN",
    );
    expect(loginRes.user.role).toBe("CASHIER");
    expect(loginRes.accessToken).toBeTruthy();
  });

  it("old password still works after PIN reset (server keeps passwordHash)", async () => {
    client.clearToken();

    // The server's resetPin endpoint only updates pinHash, it does NOT clear
    // passwordHash. So the user can still authenticate with either method.
    const loginRes = await client.login(
      "cashier-integration-test",
      "CashierTest123!",
    );
    expect(loginRes.user.role).toBe("CASHIER");
    expect(loginRes.accessToken).toBeTruthy();
  });

  it("rejects resetting PIN for a non-existent user (404)", async () => {
    client.clearToken();
    await client.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);

    await expect(
      client.resetUserPin("00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(/404|Not Found/i);
  });

  it("rejects resetting PIN by CASHIER (role enforcement)", async () => {
    client.clearToken();
    await client.login("cashier-integration-test", _newPin, "PIN");

    await expect(
      client.resetUserPin("some-user-id"),
    ).rejects.toThrow(/403|Forbidden|insufficient/i);
  });

  // -----------------------------------------------------------------------
  // Session management
  // -----------------------------------------------------------------------

  it("lists the current user's active sessions", async () => {
    // Logged in as cashier from previous test
    const sessions = await client.listMySessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    const current = sessions[0] as Record<string, unknown>;
    expect(current).toHaveProperty("id");
    expect(current).toHaveProperty("userId");
    expect(current).toHaveProperty("workstationId");
    expect(current).toHaveProperty("status");
    expect(current.status).toBe("ACTIVE");
  });

  it("GET /auth/me returns user info when logged in", async () => {
    const me = await client.me();
    expect(me).toHaveProperty("id");
    expect(me.username).toBe("cashier-integration-test");
    expect(me.role).toBe("CASHIER");
  });

  it("POST /auth/logout revokes the current session", async () => {
    await client.logout();
    // After logout, the token is cleared from the client
    expect(client.accessToken).toBeNull();
  });

  it("GET /auth/me returns 401 after logout", async () => {
    await expect(client.me()).rejects.toThrow(/401|Unauthorized/i);
  });

  it("re-logs in as admin for session revocation tests", async () => {
    client.clearToken();
    const loginRes = await client.login(
      TEST_IDS.ADMIN_USERNAME,
      TEST_IDS.ADMIN_PASSWORD,
    );
    expect(loginRes.accessToken).toBeTruthy();
  });

  it("revokes own session and the token stops working", async () => {
    // List sessions to find the current one
    const sessions = await client.listMySessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    const currentSession = sessions.find(
      (s: Record<string, unknown>) => s.status === "ACTIVE",
    ) as Record<string, unknown> | undefined;
    expect(currentSession).toBeDefined();

    // Revoke it (this should invalidate the current token)
    const result = await client.revokeMySession(currentSession!.id as string);
    expect(result.message).toBe("Session revoked");

    // Now the token should be invalid
    await expect(client.me()).rejects.toThrow(/401|Unauthorized/i);
  });

  it("can still login after session revocation", async () => {
    client.clearToken();

    const loginRes = await client.login(
      TEST_IDS.ADMIN_USERNAME,
      TEST_IDS.ADMIN_PASSWORD,
    );
    expect(loginRes.accessToken).toBeTruthy();
    const me = await client.me();
    expect(me.username).toBe(TEST_IDS.ADMIN_USERNAME);
  });

  // -----------------------------------------------------------------------
  // Token refresh (POST /auth/refresh)
  // -----------------------------------------------------------------------

  it("re-logs in as admin before refresh tests", async () => {
    client.clearToken();
    const loginRes = await client.login(
      TEST_IDS.ADMIN_USERNAME,
      TEST_IDS.ADMIN_PASSWORD,
    );
    expect(loginRes.accessToken).toBeTruthy();
  });

  it("refreshes the access token", async () => {
    // Logged in as admin from previous test
    const oldToken = client.accessToken;
    expect(oldToken).toBeTruthy();

    const refreshRes = await client.refreshSession();

    expect(refreshRes).toHaveProperty("accessToken");
    expect(refreshRes).toHaveProperty("refreshToken");
    expect(refreshRes).toHaveProperty("expiresAt");

    // The new token should differ from the old one
    expect(refreshRes.accessToken).not.toBe(oldToken);

    // The new token should let us access protected endpoints
    const me = await client.me();
    expect(me.username).toBe(TEST_IDS.ADMIN_USERNAME);
  });

  it("old access token no longer works after refresh", async () => {
    // Store the old token before refreshing again
    const firstToken = client.accessToken;
    expect(firstToken).toBeTruthy();

    // Refresh to get a new token (old one is invalidated)
    const refreshRes = await client.refreshSession();
    expect(refreshRes.accessToken).toBeTruthy();

    // Try using the old token explicitly by setting it back
    const tempClient = new TestClient(SERVER_URL, WORKSTATION_ID);
    (tempClient as any)._accessToken = firstToken;

    await expect(tempClient.me()).rejects.toThrow(/401|Unauthorized/i);
  });

  // -----------------------------------------------------------------------
  // Stale access token cannot refresh (caught by JWT guard)
  // -----------------------------------------------------------------------

  it("rejects refresh with a stale access token (401)", async () => {
    // Save the current access token before it gets replaced
    const originalToken = client.accessToken;
    expect(originalToken).toBeTruthy();

    // First refresh succeeds and issues new tokens (old token's hash replaced)
    await client.refreshSession();

    // A separate TestClient holding the stale token cannot refresh
    const staleClient = new TestClient(SERVER_URL, WORKSTATION_ID);
    (staleClient as any)._accessToken = originalToken;

    await expect(staleClient.refreshSession()).rejects.toThrow(
      /401|Session expired/i,
    );
  });

  it("can still login after stale token rejection", async () => {
    client.clearToken();

    const loginRes = await client.login(
      TEST_IDS.ADMIN_USERNAME,
      TEST_IDS.ADMIN_PASSWORD,
    );
    expect(loginRes.accessToken).toBeTruthy();
    const me = await client.me();
    expect(me.username).toBe(TEST_IDS.ADMIN_USERNAME);
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

  // -----------------------------------------------------------------------
  // Location-based access control
  // -----------------------------------------------------------------------

  const LOC_A = "loc-integration-a";
  const LOC_B = "loc-integration-b";

  let _userInLocA: string = "";
  let _managerLocA: string = "";

  it("creates a cashier with locationIds", async () => {
    // Re-login as admin
    client.clearToken();
    await client.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);

    const newUser = await client.createUser({
      displayName: "Cashier in Location A",
      username: "cashier-loc-a",
      role: "CASHIER",
      initialPassword: "LocATest123!",
      locationIds: [LOC_A],
    });

    expect(newUser.id).toBeTruthy();
    _userInLocA = newUser.id;

    // Verify via GET /users/:id that locationAccess is stored
    const details = await client.getUser(newUser.id);
    expect(details.locationAccess).toBeDefined();
    const locAccess = details.locationAccess as Array<{ locationId: string }>;
    expect(locAccess.length).toBe(1);
    expect(locAccess[0].locationId).toBe(LOC_A);
  });

  it("creates a MANAGER user with locationIds for Location A", async () => {
    const newUser = await client.createUser({
      displayName: "Manager of Location A",
      username: "manager-loc-a",
      role: "MANAGER",
      initialPassword: "ManagerLocA123!",
      locationIds: [LOC_A],
    });

    expect(newUser.id).toBeTruthy();
    _managerLocA = newUser.id;

    // Verify locationAccess
    const details = await client.getUser(newUser.id);
    const locAccess = details.locationAccess as Array<{ locationId: string }>;
    expect(locAccess.length).toBe(1);
    expect(locAccess[0].locationId).toBe(LOC_A);
  });

  it("creates a cashier in Location B (no location overlap)", async () => {
    const newUser = await client.createUser({
      displayName: "Cashier in Location B",
      username: "cashier-loc-b",
      role: "CASHIER",
      initialPassword: "LocBTest123!",
      locationIds: [LOC_B],
    });

    expect(newUser.id).toBeTruthy();

    // Verify via DB
    const details = await client.getUser(newUser.id);
    const locAccess = details.locationAccess as Array<{ locationId: string }>;
    expect(locAccess.length).toBe(1);
    expect(locAccess[0].locationId).toBe(LOC_B);
  });

  it("MANAGER of Location A sees cashier in Loc A but NOT cashier in Loc B", async () => {
    client.clearToken();

    // Login as MANAGER of Location A
    await client.login("manager-loc-a", "ManagerLocA123!");

    const result = await client.listUsers();

    // The MANAGER should see the admin user, the cashier in LOC_A, and themselves
    const userIds = result.users.map(
      (u: Record<string, unknown>) => u.id as string,
    );

    // Should see the cashier in Location A (same location)
    expect(userIds).toContain(_userInLocA);

    // Should NOT see the cashier in Location B (different location)
    const locBUser = await db.findUserByUsername("cashier-loc-b");
    expect(locBUser).not.toBeNull();
    expect(userIds).not.toContain(locBUser!.id);
  });

  it("updates a user's locationIds via PATCH", async () => {
    client.clearToken();
    await client.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);

    // Move the Location A cashier to Location B
    const updated = await client.updateUser(_userInLocA, {
      locationIds: [LOC_B],
    });

    expect(updated).toBeDefined();

    // Verify via GET /users/:id
    const details = await client.getUser(_userInLocA);
    const locAccess = details.locationAccess as Array<{ locationId: string }>;
    expect(locAccess.length).toBe(1);
    expect(locAccess[0].locationId).toBe(LOC_B);
  });

  it("MANAGER no longer sees the user after location change", async () => {
    client.clearToken();

    // Login as MANAGER of Location A
    await client.login("manager-loc-a", "ManagerLocA123!");

    const result = await client.listUsers();
    const userIds = result.users.map(
      (u: Record<string, unknown>) => u.id as string,
    );

    // The cashier moved to LOC_B, so MANAGER of LOC_A should no longer see them
    expect(userIds).not.toContain(_userInLocA);
  });

  it("clears locationIds via PATCH with empty array", async () => {
    client.clearToken();
    await client.login(TEST_IDS.ADMIN_USERNAME, TEST_IDS.ADMIN_PASSWORD);

    await client.updateUser(_userInLocA, {
      locationIds: [],
    });

    // Verify via GET /users/:id
    const details = await client.getUser(_userInLocA);
    expect(details.locationAccess).toEqual([]);
  });
});
