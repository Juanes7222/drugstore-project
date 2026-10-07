// Concurrency verification for VerificationTokenService.consume().
//
// WHY THIS CANNOT BE A UNIT TEST: consume() redeems a capability with a
// conditional updateMany (WHERE consumedAt IS NULL AND expiresAt > now), not a
// read-then-write. A mock can only assert that the right query was issued; it
// cannot make two callers interleave. If the redemption were ever rewritten as
// "SELECT then UPDATE", every mocked test would still pass while two
// simultaneous clicks on one emailed link both succeeded. This spec runs both
// callers against real PostgreSQL 16 so the database, not the mock, decides
// which one wins.
//
// Infrastructure follows test/reports-raw-sql.e2e-spec.ts: a throwaway
// postgres:16-alpine container started with @testcontainers/postgresql, schema
// applied with `prisma migrate deploy`, and a real PrismaService wired to it.
//
// RLS note: VerificationToken deliberately carries NO row-level security
// policy (packages/database/prisma/schema/models/auth.prisma:201) because these
// endpoints are unauthenticated and have no app.current_tenant to filter on.
// No tenant context is set here for exactly that reason.

process.env.TZ = 'UTC';

import { execSync } from 'node:child_process';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient, VerificationPurpose } from '@pharmacy/database';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { TenantContextService } from '../src/modules/tenant/tenant-context.service';
import { VerificationTokenService } from '../src/modules/auth/services/verification-token.service';
import { InvalidVerificationTokenException } from '../src/modules/auth/exceptions/invalid-verification-token.exception';

const USER_ID = 'e2e-vtok-user';
const USER_EMAIL = 'e2e-vtok-user@example.com';

describe('VerificationTokenService.consume concurrency (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let seedClient: PrismaClient;
  let prismaService: PrismaService;
  let service: VerificationTokenService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const containerUrl = container.getConnectionUri();
    // PrismaService resolves its connection from APP_DATABASE_URL with
    // DATABASE_URL as fallback, and test/set-env.ts presets BOTH to the
    // docker-compose database, so both must be repointed at the container
    // before the module is compiled. VerificationToken has no RLS policy, so
    // connecting as the container superuser does not weaken these assertions
    // (see the RLS note at the top of this file).
    process.env.DATABASE_URL = containerUrl;
    process.env.APP_DATABASE_URL = containerUrl;

    // Jest always runs with cwd = apps/server (rootDir '.' in
    // jest.e2e.config.ts), so this relative path resolves.
    const prismaBin =
      process.platform === 'win32'
        ? '.\\node_modules\\.bin\\prisma.CMD'
        : './node_modules/.bin/prisma';
    execSync(
      `${prismaBin} migrate deploy --config ../../packages/database/prisma.full.config.ts`,
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: containerUrl },
        stdio: 'pipe',
      },
    );

    // Plain client for seeding and raw reads: superuser connection bypasses
    // RLS. Only model delegates are used, so any schema variant works.
    seedClient = new PrismaClient({
      adapter: new PrismaPg({ connectionString: containerUrl }),
    });
    await seedClient.$connect();

    await seedClient.user.create({
      data: {
        id: USER_ID,
        fullName: 'E2E Verification Token User',
        role: 'OWNER',
        email: USER_EMAIL,
        status: 'ACTIVE',
        isActive: true,
      },
    });

    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService, TenantContextService],
    }).compile();

    prismaService = moduleRef.get(PrismaService);
    await prismaService.onModuleInit();
    service = new VerificationTokenService(prismaService);
  }, 240_000);

  afterAll(async () => {
    await prismaService?.onModuleDestroy();
    await seedClient?.$disconnect();
    await container?.stop();
  });

  describe('two concurrent consume() calls with the same raw token', () => {
    it('lets exactly one claim succeed and rejects the other', async () => {
      const issued = await service.issue({
        userId: USER_ID,
        email: USER_EMAIL,
        purpose: VerificationPurpose.EMAIL_VERIFICATION,
        ttlMs: 3_600_000,
        cooldownMs: 0,
      });
      expect(issued).not.toBeNull();

      const rawToken = issued!.rawToken;

      // Fired together without awaiting in between: both reach the conditional
      // UPDATE before either can observe the other's committed consumedAt.
      const both = await Promise.allSettled([
        service.consume(rawToken, VerificationPurpose.EMAIL_VERIFICATION),
        service.consume(rawToken, VerificationPurpose.EMAIL_VERIFICATION),
      ]);

      const fulfilled = both.filter((r) => r.status === 'fulfilled');
      const rejected = both.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(
        (rejected[0] as PromiseRejectedResult).reason,
      ).toBeInstanceOf(InvalidVerificationTokenException);
    });

    it('reports the owning account to whichever caller won', async () => {
      const issued = await service.issue({
        userId: USER_ID,
        email: USER_EMAIL,
        purpose: VerificationPurpose.EMAIL_VERIFICATION,
        ttlMs: 3_600_000,
        cooldownMs: 0,
      });

      const results = await Promise.allSettled([
        service.consume(issued!.rawToken, VerificationPurpose.EMAIL_VERIFICATION),
        service.consume(issued!.rawToken, VerificationPurpose.EMAIL_VERIFICATION),
      ]);

      const winner = results.find((r) => r.status === 'fulfilled') as
        PromiseFulfilledResult<{
          userId: string;
          purpose: string;
          email: string;
        }>;

      expect(winner.value).toEqual({
        userId: USER_ID,
        purpose: VerificationPurpose.EMAIL_VERIFICATION,
        email: USER_EMAIL,
      });
    });

    it('leaves the row consumed exactly once', async () => {
      const issued = await service.issue({
        userId: USER_ID,
        email: USER_EMAIL,
        purpose: VerificationPurpose.EMAIL_VERIFICATION,
        ttlMs: 3_600_000,
        cooldownMs: 0,
      });

      await Promise.allSettled([
        service.consume(issued!.rawToken, VerificationPurpose.EMAIL_VERIFICATION),
        service.consume(issued!.rawToken, VerificationPurpose.EMAIL_VERIFICATION),
      ]);

      const rows = await seedClient.verificationToken.findMany({
        where: { id: issued!.tokenId },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].consumedAt).toBeInstanceOf(Date);
    });

    it('rejects a third replay after the token has already been consumed', async () => {
      const issued = await service.issue({
        userId: USER_ID,
        email: USER_EMAIL,
        purpose: VerificationPurpose.EMAIL_VERIFICATION,
        ttlMs: 3_600_000,
        cooldownMs: 0,
      });

      await Promise.allSettled([
        service.consume(issued!.rawToken, VerificationPurpose.EMAIL_VERIFICATION),
        service.consume(issued!.rawToken, VerificationPurpose.EMAIL_VERIFICATION),
      ]);

      await expect(
        service.consume(issued!.rawToken, VerificationPurpose.EMAIL_VERIFICATION),
      ).rejects.toThrow(InvalidVerificationTokenException);
    });
  });

  describe('purpose binding under concurrency', () => {
    it('refuses a PASSWORD_RESET token redeemed at the EMAIL_VERIFICATION purpose', async () => {
      const issued = await service.issue({
        userId: USER_ID,
        email: USER_EMAIL,
        purpose: VerificationPurpose.PASSWORD_RESET,
        ttlMs: 3_600_000,
        cooldownMs: 0,
      });

      await expect(
        service.consume(
          issued!.rawToken,
          VerificationPurpose.EMAIL_VERIFICATION,
        ),
      ).rejects.toThrow(InvalidVerificationTokenException);
    });

    it('still lets the correct purpose redeem it afterwards', async () => {
      const issued = await service.issue({
        userId: USER_ID,
        email: USER_EMAIL,
        purpose: VerificationPurpose.PASSWORD_RESET,
        ttlMs: 3_600_000,
        cooldownMs: 0,
      });

      await expect(
        service.consume(
          issued!.rawToken,
          VerificationPurpose.EMAIL_VERIFICATION,
        ),
      ).rejects.toThrow(InvalidVerificationTokenException);

      await expect(
        service.consume(issued!.rawToken, VerificationPurpose.PASSWORD_RESET),
      ).resolves.toMatchObject({ userId: USER_ID });
    });
  });

  describe('expiry under concurrency', () => {
    it('refuses an expired token for both concurrent callers', async () => {
      const issued = await service.issue({
        userId: USER_ID,
        email: USER_EMAIL,
        purpose: VerificationPurpose.EMAIL_VERIFICATION,
        // Already in the past, so the expiresAt > now predicate can never hold.
        ttlMs: -1_000,
        cooldownMs: 0,
      });

      const results = await Promise.allSettled([
        service.consume(issued!.rawToken, VerificationPurpose.EMAIL_VERIFICATION),
        service.consume(issued!.rawToken, VerificationPurpose.EMAIL_VERIFICATION),
      ]);

      expect(results.every((r) => r.status === 'rejected')).toBe(true);
      results.forEach((r) => {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
          InvalidVerificationTokenException,
        );
      });
    });
  });

  describe('raw token storage', () => {
    it('never persists the raw token, so reading the table yields no working link', async () => {
      const issued = await service.issue({
        userId: USER_ID,
        email: USER_EMAIL,
        purpose: VerificationPurpose.EMAIL_VERIFICATION,
        ttlMs: 3_600_000,
        cooldownMs: 0,
      });

      const rows = await seedClient.verificationToken.findMany({
        where: { id: issued!.tokenId },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).not.toBe(issued!.rawToken);
      expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('purgeExpired against real rows', () => {
    it('deletes only rows past the cutoff and leaves fresher ones intact', async () => {
      const stale = await service.issue({
        userId: USER_ID,
        email: USER_EMAIL,
        purpose: VerificationPurpose.EMAIL_VERIFICATION,
        ttlMs: -1_000,
        cooldownMs: 0,
      });
      const fresh = await service.issue({
        userId: USER_ID,
        email: USER_EMAIL,
        purpose: VerificationPurpose.PASSWORD_RESET,
        ttlMs: 3_600_000,
        cooldownMs: 0,
      });

      const purged = await service.purgeExpired(0);

      const remaining = await seedClient.verificationToken.findMany({
        where: { id: { in: [stale!.tokenId, fresh!.tokenId] } },
      });

      expect(purged).toBeGreaterThanOrEqual(1);
      expect(remaining.map((r) => r.id)).toEqual([fresh!.tokenId]);
    });
  });
});