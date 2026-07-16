/**
 * Test database helper.
 *
 * Connects directly to the test PostgreSQL (via PrismaClient from
 * `@pharmacy/database`) to seed initial data and clean up state between tests.
 *
 * ## Why direct database access instead of API calls
 *
 * - Seeding admin users requires a hashed password that can only be created
 *   by the server's `PasswordHasherService`.  By inserting the hash directly,
 *   we avoid depending on a public registration endpoint that doesn't exist.
 * - Cleanup (truncating tables) is faster and more reliable than issuing
 *   DELETE API calls for every record created during a test.
 * - Introspection (checking what the server stored) lets us verify that API
 *   calls had the intended side effects without exposing internal data via a
 *   test-only endpoint.
 *
 * ## Usage
 *
 * ```ts
 * const db = new TestDatabase();
 * await db.seedAdminUser({ username: "admin", password: "Test123!" });
 * // ... run tests ...
 * await db.truncateAll();
 * await db.close();
 * ```
 */
import { PrismaClient } from "@pharmacy/database";
import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DATABASE_URL =
  "postgresql://pharmacy_test:pharmacy_test@localhost:5433/pharmacy_test_db";

/** Well-known IDs used by the test harness so tests can reference them. */
export const TEST_IDS = {
  WORKSTATION: "integration-test-ws-001",
  ADMIN_USER: "integration-test-admin-001",
  ADMIN_USERNAME: "admin@pharmacy.test",
  ADMIN_PASSWORD: "AdminTest123!",
  /** Role that can create users (must match @Roles(RoleType.OWNER, RoleType.MANAGER) in users.controller). */
  ADMIN_ROLE: "OWNER",
} as const;

// ---------------------------------------------------------------------------
// TestDatabase
// ---------------------------------------------------------------------------

export interface SeedUserOptions {
  id: string;
  username: string;
  password: string;
  role: string;
  fullName?: string;
}

export class TestDatabase {
  private prisma: PrismaClient;

  constructor(databaseUrl?: string) {
    const url = databaseUrl ?? process.env.TEST_DATABASE_URL ?? DEFAULT_DATABASE_URL;
    const adapter = new PrismaPg({ connectionString: url });
    this.prisma = new PrismaClient({ adapter });
  }

  /** Connect to the database. */
  async connect(): Promise<void> {
    await this.prisma.$connect();
  }

  /** Disconnect from the database. */
  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Truncate all tables in the public schema.
   *
   * Uses a single `TRUNCATE` statement with `CASCADE` to handle foreign keys.
   * Skips Prisma's `_Migration` and `_prisma_migrations` tables.
   */
  async truncateAll(): Promise<void> {
    // Disable FK checks temporarily for the truncation
    await this.prisma.$executeRawUnsafe(`SET session_replication_role = 'replica';`);

    const tables = await this.prisma.$queryRawUnsafe<
      Array<{ tablename: string }>
    >(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename NOT LIKE '%migration%'
         AND tablename NOT LIKE '_prisma%'`,
    );

    if (tables.length > 0) {
      const tableNames = tables.map((t) => `"${t.tablename}"`).join(", ");
      await this.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} CASCADE;`);
    }

    await this.prisma.$executeRawUnsafe(`SET session_replication_role = 'origin';`);
  }

  // -----------------------------------------------------------------------
  // Seeding
  // -----------------------------------------------------------------------

  /**
   * Seed a workstation used by integration tests.
   */
  async seedWorkstation(overrides?: {
    id?: string;
    name?: string;
    code?: string;
  }): Promise<void> {
    const id = overrides?.id ?? TEST_IDS.WORKSTATION;
    await this.prisma.workstation.upsert({
      where: { id },
      create: {
        id,
        name: overrides?.name ?? "Integration Test Workstation",
        code: overrides?.code ?? "WS-INT-001",
        isActive: true,
        registeredAt: new Date(),
      },
      update: {},
    });
  }

  /**
   * Seed a user with a known password (argon2-hashed).
   *
   * The user will be created with `ACTIVE` status and can be used to log in
   * via the standard `POST /auth/login` endpoint.
   */
  async seedUser(options: SeedUserOptions): Promise<void> {
    const passwordHash = await argon2.hash(options.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    await this.prisma.user.upsert({
      where: { id: options.id },
      create: {
        id: options.id,
        username: options.username,
        fullName: options.fullName ?? options.username,
        passwordHash,
        passwordAlgorithm: "argon2id",
        role: options.role,
        status: "ACTIVE",
        isActive: true,
        authMethod: "PASSWORD_ONLY",
        emailVerifiedAt: new Date(),
      },
      update: {
        passwordHash,
        passwordAlgorithm: "argon2id",
        status: "ACTIVE",
        isActive: true,
      },
    });
  }

  /**
   * Seed the default admin user and workstation.
   *
   * Convenience wrapper — calls both `seedWorkstation()` and `seedUser()`
   * with the well-known test admin credentials.
   */
  async seedDefaults(): Promise<void> {
    await this.seedWorkstation();
    await this.seedUser({
      id: TEST_IDS.ADMIN_USER,
      username: TEST_IDS.ADMIN_USERNAME,
      password: TEST_IDS.ADMIN_PASSWORD,
      role: TEST_IDS.ADMIN_ROLE,
      fullName: "Integration Test Admin",
    });
  }

  // -----------------------------------------------------------------------
  // Introspection helpers
  // -----------------------------------------------------------------------

  /**
   * Count users by role.
   */
  async countUsersByRole(): Promise<Record<string, number>> {
    const rows = await this.prisma.user.groupBy({
      by: ["role"],
      _count: { id: true },
    });
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.role] = row._count.id;
    }
    return result;
  }

  /**
   * Find a user by username.
   */
  async findUserByUsername(username: string) {
    return this.prisma.user.findFirst({ where: { username } });
  }

  /**
   * Find a user by id.
   */
  async findUserById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
