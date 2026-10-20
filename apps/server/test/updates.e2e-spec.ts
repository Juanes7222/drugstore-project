import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TenantContextInterceptor } from '../src/modules/tenant/tenant-context.interceptor';

/**
 * End-to-end test for the auto-update delivery flow.
 *
 * It walks the real path a published update takes, against a real database
 * and the real object storage:
 *
 *   admin panel upload -> publish (DRAFT) -> activate -> workstation check
 *   -> binary download -> telemetry -> admin dashboard
 *
 * The point of the spec is the chain, not the endpoints: a check that
 * returns an update whose download 404s, or a binary that reaches the
 * workstation without its signature matching, would each pass an
 * endpoint-level test while breaking the update for every workstation.
 */

const ADMIN_USER_ID = 'e2e-updates-admin';
const CASHIER_USER_ID = 'e2e-updates-cashier';
const ADMIN_USERNAME = 'e2e-updates-admin@updates.test';
const CASHIER_USERNAME = 'e2e-updates-cashier@updates.test';
const TEST_PASSWORD = 'UpdatesPass123!';

const VERSION = '9.9.9';
const CHANNEL = 'STABLE';
const FILENAME = 'pos-setup.exe';
const WORKSTATION_ID = 'e2e-updates-workstation';
const LICENSE_ID = 'e2e-updates-license';

/** A payload big enough that the magic-number check cannot read it as text. */
const INSTALLER_BYTES = Buffer.concat([
  Buffer.from('MZ\x90\x00', 'binary'),
  crypto.randomBytes(64 * 1024),
]);

describe('Auto-update delivery (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let cashierToken: string;
  let storageRoot: string;
  let telemetrySecret: string;
  let publishedId: string;

  const login = async (identifier: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        identifier,
        secret: TEST_PASSWORD,
        sessionType: 'PASSWORD',
      })
      .expect(200);
    return res.body.accessToken as string;
  };

  const publish = (binary: Buffer, metadata: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/admin/updates/versions')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('metadata', JSON.stringify(metadata))
      .attach('binary', binary, {
        filename: FILENAME,
        contentType: 'application/octet-stream',
      });

  const defaultMetadata = {
    version: VERSION,
    channel: CHANNEL,
    updateType: 'OPTIONAL',
    rolloutStrategy: 'INSTANT',
    releaseNotes: 'e2e release',
  };

  /** Sign a telemetry event the way the POS client does. */
  const signTelemetry = (payload: {
    workstationId: string;
    licenseId: string;
    fromVersion: string;
    toVersion?: string | null;
    attemptId: string;
    outcome: string;
    occurredAt: string;
  }): string => {
    const workstationKey = crypto
      .createHmac('sha256', telemetrySecret)
      .update(payload.licenseId, 'utf-8')
      .digest('hex');
    const signed = [
      payload.workstationId,
      payload.licenseId,
      payload.fromVersion,
      payload.toVersion ?? '',
      payload.attemptId,
      payload.outcome,
      payload.occurredAt,
    ].join('|');
    return crypto
      .createHmac('sha256', workstationKey)
      .update(signed, 'utf-8')
      .digest('hex');
  };

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await prisma.$connect();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(app.get(TenantContextInterceptor));
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    const config = app.get(ConfigService);
    telemetrySecret = config.getOrThrow<string>('UPDATE_TELEMETRY_HMAC_SECRET');
    storageRoot = path.resolve(
      process.cwd(),
      config.get<string>('UPDATE_STORAGE_PATH') ?? './storage/updates',
    );

    await prisma.updateAttemptLog.deleteMany({});
    await prisma.updateVersion.deleteMany({});
    await prisma.auditLog.deleteMany({
      where: { userId: { in: [ADMIN_USER_ID, CASHIER_USER_ID] } },
    });
    await prisma.userSession.deleteMany({
      where: { userId: { in: [ADMIN_USER_ID, CASHIER_USER_ID] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ADMIN_USER_ID, CASHIER_USER_ID] } },
    });

    const passwordHash = await argon2.hash(TEST_PASSWORD);
    await prisma.user.createMany({
      data: [
        {
          id: ADMIN_USER_ID,
          username: ADMIN_USERNAME,
          fullName: 'E2E Updates Admin',
          passwordHash,
          passwordAlgorithm: 'argon2',
          role: 'SAAS_ADMIN',
          status: 'ACTIVE',
          isActive: true,
          emailVerifiedAt: new Date(),
        },
        {
          id: CASHIER_USER_ID,
          username: CASHIER_USERNAME,
          fullName: 'E2E Updates Cashier',
          passwordHash,
          passwordAlgorithm: 'argon2',
          role: 'CASHIER',
          status: 'ACTIVE',
          isActive: true,
          emailVerifiedAt: new Date(),
        },
      ],
    });

    adminToken = await login(ADMIN_USERNAME);
    cashierToken = await login(CASHIER_USERNAME);
  }, 60000);

  afterAll(async () => {
    await prisma.updateAttemptLog.deleteMany({});
    await prisma.updateVersion.deleteMany({});
    // Logins are audited, and the audit rows reference the session.
    await prisma.auditLog.deleteMany({
      where: { userId: { in: [ADMIN_USER_ID, CASHIER_USER_ID] } },
    });
    await prisma.userSession.deleteMany({
      where: { userId: { in: [ADMIN_USER_ID, CASHIER_USER_ID] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ADMIN_USER_ID, CASHIER_USER_ID] } },
    });
    fs.rmSync(path.join(storageRoot, CHANNEL, VERSION), {
      recursive: true,
      force: true,
    });

    await app.close();
    await prisma.$disconnect();
  }, 60000);

  describe('publishing from the admin panel', () => {
    it('rejects a user without the SAAS_ADMIN role', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/updates/versions')
        .set('Authorization', `Bearer ${cashierToken}`)
        .field('metadata', JSON.stringify(defaultMetadata))
        .attach('binary', INSTALLER_BYTES, {
          filename: FILENAME,
          contentType: 'application/octet-stream',
        });

      expect(res.status).toBe(403);
    });

    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/updates/versions')
        .field('metadata', JSON.stringify(defaultMetadata))
        .attach('binary', INSTALLER_BYTES, {
          filename: FILENAME,
          contentType: 'application/octet-stream',
        });

      expect(res.status).toBe(401);
    });

    it('stores the binary, signs it and leaves the version in DRAFT', async () => {
      const res = await publish(INSTALLER_BYTES, defaultMetadata).expect(201);

      publishedId = res.body.id as string;
      expect(res.body.version).toBe(VERSION);
      expect(res.body.channel).toBe(CHANNEL);
      expect(res.body.state).toBe('DRAFT');
      expect(res.body.isActive).toBe(false);
      expect(res.body.fileSize).toBe(INSTALLER_BYTES.length);
      expect(res.body.fileHash).toBe(
        crypto.createHash('sha256').update(INSTALLER_BYTES).digest('hex'),
      );
      // The server signs the binary: the publisher never declares the
      // signature itself.
      expect(res.body.signature).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.downloadUrl).toContain(
        `/updates/download/${CHANNEL}/${VERSION}/${FILENAME}`,
      );

      const stored = fs.readFileSync(
        path.join(storageRoot, CHANNEL, VERSION, FILENAME),
      );
      expect(stored.equals(INSTALLER_BYTES)).toBe(true);
    });

    it('refuses to publish the same version twice for the same channel', async () => {
      const res = await publish(INSTALLER_BYTES, defaultMetadata);

      expect(res.status).toBe(409);
    });
  });

  describe('workstation check', () => {
    it('does not offer a draft version', async () => {
      const res = await request(app.getHttpServer())
        .get('/updates/check')
        .query({
          currentVersion: '0.0.1',
          workstationId: WORKSTATION_ID,
          channel: CHANNEL,
        })
        .expect(200);

      expect(res.body.updateAvailable).toBe(false);
    });

    it('offers the version once it is activated', async () => {
      await request(app.getHttpServer())
        .post(`/admin/updates/versions/${publishedId}/activate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/updates/check')
        .query({
          currentVersion: '0.0.1',
          workstationId: WORKSTATION_ID,
          channel: CHANNEL,
        })
        .expect(200);

      expect(res.body.updateAvailable).toBe(true);
      expect(res.body.version).toBe(VERSION);
      expect(res.body.fileHash).toBe(
        crypto.createHash('sha256').update(INSTALLER_BYTES).digest('hex'),
      );
      expect(res.body.downloadUrl).toContain(FILENAME);
    });

    it('does not offer the version to a workstation that already runs it', async () => {
      const res = await request(app.getHttpServer())
        .get('/updates/check')
        .query({
          currentVersion: VERSION,
          workstationId: WORKSTATION_ID,
          channel: CHANNEL,
        })
        .expect(200);

      expect(res.body.updateAvailable).toBe(false);
    });
  });

  describe('binary download', () => {
    it('serves the published bytes to the workstation', async () => {
      const res = await request(app.getHttpServer())
        .get(`/updates/download/${CHANNEL}/${VERSION}/${FILENAME}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('application/octet-stream');
      expect(res.headers['content-length']).toBe(
        String(INSTALLER_BYTES.length),
      );
      expect(Buffer.from(res.body).equals(INSTALLER_BYTES)).toBe(true);
    });

    it('refuses a file name that was not the published one', async () => {
      const res = await request(app.getHttpServer())
        .get(`/updates/download/${CHANNEL}/${VERSION}/other-setup.exe`);

      expect(res.status).toBe(404);
    });

    it('refuses a version that was never published', async () => {
      const res = await request(app.getHttpServer())
        .get(`/updates/download/${CHANNEL}/0.0.0/${FILENAME}`);

      expect(res.status).toBe(404);
    });

    it('refuses to serve a binary whose signature no longer matches', async () => {
      const target = path.join(storageRoot, CHANNEL, VERSION, FILENAME);
      fs.writeFileSync(target, Buffer.from('tampered-binary'));

      const res = await request(app.getHttpServer())
        .get(`/updates/download/${CHANNEL}/${VERSION}/${FILENAME}`);

      expect(res.status).toBe(403);

      // Restore the published bytes for the remaining specs.
      fs.writeFileSync(target, INSTALLER_BYTES);
    });
  });

  describe('telemetry', () => {
    it('records a signed install and surfaces it in the version detail', async () => {
      const occurredAt = new Date().toISOString();
      const payload = {
        workstationId: WORKSTATION_ID,
        licenseId: LICENSE_ID,
        fromVersion: '0.0.1',
        toVersion: VERSION,
        attemptId: crypto.randomUUID(),
        outcome: 'INSTALL_COMPLETED',
        occurredAt,
      };

      await request(app.getHttpServer())
        .post('/updates/telemetry')
        .send({ ...payload, signature: signTelemetry(payload) })
        .expect(202);

      const detail = await request(app.getHttpServer())
        .get(`/admin/updates/versions/${publishedId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(detail.body.telemetry.totalInstalls).toBe(1);
      expect(detail.body.telemetry.successRate).toBe(1);
      expect(detail.body.telemetry.uniqueWorkstations).toBe(1);
    });

    it('rejects an event whose signature does not match', async () => {
      const occurredAt = new Date().toISOString();
      const payload = {
        workstationId: WORKSTATION_ID,
        licenseId: LICENSE_ID,
        fromVersion: '0.0.1',
        toVersion: VERSION,
        attemptId: crypto.randomUUID(),
        outcome: 'INSTALL_FAILED',
        occurredAt,
      };

      await request(app.getHttpServer())
        .post('/updates/telemetry')
        .send({ ...payload, signature: 'a'.repeat(64) })
        .expect(401);
    });
  });
});
