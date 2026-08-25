// jest.mock factories are used instead of jest.unstable_mockModule: the
// latter does not register in this Jest/ts-jest ESM setup.
jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { createPrismaDatabaseMock } from '../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());
jest.mock('./services/password-hasher.service', () => ({
  PasswordHasherService: class {},
}));
jest.mock('./services/pin.service', () => ({ PinService: class {} }));
jest.mock('./services/totp.service', () => ({ TotpService: class {} }));
jest.mock('./services/backup-codes.service', () => ({
  BackupCodesService: class {},
}));
jest.mock('./services/session.service', () => ({ SessionService: class {} }));
jest.mock('./services/audit.service', () => ({
  AuditService: class {},
  AuditEvent: {
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
    LOGIN_FAILURE: 'LOGIN_FAILURE',
    LOGOUT: 'LOGOUT',
    ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
    REFRESH_TOKEN: 'REFRESH_TOKEN',
    REVOKED_REFRESH_REUSE: 'REVOKED_REFRESH_REUSE',
    PASSWORD_CHANGED: 'PASSWORD_CHANGED',
    PIN_CHANGED: 'PIN_CHANGED',
    FORGOT_PASSWORD: 'FORGOT_PASSWORD',
    PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
    BACKUP_CODE_USED: 'BACKUP_CODE_USED',
    OFFLINE_CREDENTIALS_CACHED: 'OFFLINE_CREDENTIALS_CACHED',
    USER_CREATED: 'USER_CREATED',
  },
}));
jest.mock('./offline/offline-token.service', () => ({
  OfflineTokenService: class {},
}));
jest.mock('./offline/credential-cache.service', () => ({
  CredentialCacheService: class {},
}));

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';
import { SessionRevocationReason } from '@pharmacy/database';
import { AuthService } from './auth.service';
import { AuditEvent } from './services/audit.service';
import { FirebaseEmailConflictException } from './exceptions/firebase-email-conflict.exception';
import { AccountInactiveException } from './exceptions/account-inactive.exception';
import { SessionExpiredException } from './exceptions/session-expired.exception';
import { ForbiddenException } from '@nestjs/common';

function buildPrismaUser(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'user-default',
    subscriptionId: 'sub-1',
    role: 'OWNER',
    email: 'user@example.com',
    username: 'user@example.com',
    displayName: 'Display',
    fullName: 'Display Name',
    avatarUrl: null,
    avatarColor: null,
    authMethod: 'OAUTH_GOOGLE',
    identificationType: null,
    identificationNumber: null,
    isActive: true,
    totpEnabled: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    passwordHash: null,
    passwordAlgorithm: null,
    emailVerifiedAt: null,
    lastLoginAt: null,
    lastLoginWorkstationId: null,
    lastPasswordChangeAt: null,
    status: 'ACTIVE',
    mustChangePassword: false,
    createdById: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    firebaseUid: null,
    ...overrides,
  };
}

describe('AuthService', () => {
  let prisma: MockProxy<PrismaClient>;
  // Separate deep mock for the interactive-transaction client: workstation
  // self-registration must prove writes go THROUGH the tx (never
  // this.prisma.*), so the callback receives a distinct mock whose delegates
  // are asserted directly.
  let tx: MockProxy<PrismaClient>;
  let service: InstanceType<typeof AuthService>;
  let jwtService: { sign: jest.Mock };
  let configService: { get: jest.Mock };
  let passwordHasher: { verify: jest.Mock; hash: jest.Mock };
  let sessionService: {
    createSession: jest.Mock;
    enforceSessionLimit: jest.Mock;
    findActiveSessionByTokenHash: jest.Mock;
    updateSessionTokens: jest.Mock;
    revokeUserSessions: jest.Mock;
    touchLastActivity: jest.Mock;
  };
  let auditService: { log: jest.Mock };
  let offlineTokenService: { issueToken: jest.Mock };
  let credentialCacheService: { generateCvk: jest.Mock };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    jwtService = { sign: jest.fn().mockReturnValue('signed-jwt') };
    configService = { get: jest.fn() };
    configService.get.mockImplementation((key: string) => {
      if (key === 'JWT_ACCESS_TTL_SECONDS') return 900;
      if (key === 'JWT_REFRESH_TTL_SECONDS') return 604800;
      return undefined;
    });
    passwordHasher = {
      verify: jest.fn().mockResolvedValue(true),
      hash: jest.fn().mockResolvedValue({ hash: 'hash', algorithm: 'argon2id' }),
    };
    sessionService = {
      createSession: jest.fn().mockResolvedValue({ id: 'session-1' }),
      enforceSessionLimit: jest.fn().mockResolvedValue({ evictedSessionId: null }),
      findActiveSessionByTokenHash: jest.fn(),
      updateSessionTokens: jest.fn().mockResolvedValue({}),
      revokeUserSessions: jest.fn().mockResolvedValue(1),
      touchLastActivity: jest.fn().mockResolvedValue(undefined),
    };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    offlineTokenService = {
      issueToken: jest
        .fn()
        .mockResolvedValue({ token: 'offline-tok', expiresAt: new Date(123) }),
    };
    credentialCacheService = {
      generateCvk: jest
        .fn()
        .mockResolvedValue({ encryptedBlob: 'blob', keyFingerprint: 'fp', version: 1 }),
    };
    prisma.user.update.mockResolvedValue({} as never);
    prisma.userLocationAccess.findMany.mockResolvedValue([] as never);
    // ensureWorkstation always looks up a supplied workstation id before
    // deciding whether to self-register; resolve an existing row by default
    // so logins that pass a known id keep their previous behavior (no
    // transaction, no create). Lookups by `code` find nothing by default,
    // which is what code-generation expects.
    prisma.workstation.findUnique.mockImplementation(async (args: any) =>
      args.where.id !== undefined ? { id: args.where.id } : null,
    );
    // $transaction(interactive) must invoke its callback with the tx client -
    // never assume a transaction callback runs without wiring this explicitly.
    tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    service = new AuthService(
      prisma as unknown as PrismaClient,
      jwtService as never,
      configService as never,
      passwordHasher as never,
      {} as never,
      {} as never,
      {} as never,
      sessionService as never,
      auditService as never,
      offlineTokenService as never,
      credentialCacheService as never,
    );
  });

  describe('loginWithFirebase', () => {
    it('issues a session for an existing user matched by firebaseUid', async () => {
      const existing = buildPrismaUser({
        id: 'existing-1',
        firebaseUid: 'fb-uid-1',
        email: 'existing@example.com',
      });
      prisma.user.findFirst.mockResolvedValueOnce(existing as never);

      const result = await service.loginWithFirebase({
        firebaseUid: 'fb-uid-1',
        email: 'existing@example.com',
        displayName: null,
        photoURL: null,
        workstationId: 'ws-1',
      });

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('signed-jwt');
      expect(result.user.id).toBe('existing-1');
    });

    it('creates a new OWNER/OAUTH_GOOGLE user in PENDING_SETUP when no local account matches', async () => {
      prisma.user.findFirst.mockResolvedValueOnce(null as never).mockResolvedValueOnce(null as never);
      const created = buildPrismaUser({
        id: 'new-1',
        firebaseUid: 'fb-new',
        email: 'new@example.com',
        authMethod: 'OAUTH_GOOGLE',
        role: 'OWNER',
        status: 'PENDING_SETUP',
        isActive: false,
      });
      prisma.user.create.mockResolvedValueOnce(created as never);

      await expect(
        service.loginWithFirebase({
          firebaseUid: 'fb-new',
          email: 'new@example.com',
          displayName: 'New Person',
          photoURL: 'https://photo.example.com/p.png',
          workstationId: 'ws-2',
        }),
      ).rejects.toThrow(AccountInactiveException);

      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      const callData = (prisma.user.create as jest.Mock).mock.calls[0][0].data;
      expect(callData.role).toBe('OWNER');
      expect(callData.authMethod).toBe('OAUTH_GOOGLE');
      expect(callData.firebaseUid).toBe('fb-new');
      expect(callData.status).toBe('PENDING_SETUP');
      expect(callData.isActive).toBe(false);
      expect(callData.email).toBe('new@example.com');
      expect(callData.fullName).toBe('New Person');
      expect(callData.displayName).toBe('New Person');
      expect(callData.avatarUrl).toBe('https://photo.example.com/p.png');
      expect(sessionService.createSession).not.toHaveBeenCalled();
    });

    it('rejects self-registration from an email domain outside BACKOFFICE_ALLOWED_DOMAINS', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'JWT_ACCESS_TTL_SECONDS') return 900;
        if (key === 'JWT_REFRESH_TTL_SECONDS') return 604800;
        if (key === 'BACKOFFICE_ALLOWED_DOMAINS') {
          return 'company.com,company.co';
        }
        return undefined;
      });
      prisma.user.findFirst.mockResolvedValueOnce(null as never).mockResolvedValueOnce(null as never);

      await expect(
        service.loginWithFirebase({
          firebaseUid: 'fb-new',
          email: 'attacker@gmail.com',
          displayName: null,
          photoURL: null,
          workstationId: 'ws-2',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('allows self-registration from an allowlisted domain (account still pending approval)', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'JWT_ACCESS_TTL_SECONDS') return 900;
        if (key === 'JWT_REFRESH_TTL_SECONDS') return 604800;
        if (key === 'BACKOFFICE_ALLOWED_DOMAINS') {
          return 'company.com,company.co';
        }
        return undefined;
      });
      prisma.user.findFirst.mockResolvedValueOnce(null as never).mockResolvedValueOnce(null as never);
      prisma.user.create.mockResolvedValueOnce(
        buildPrismaUser({
          id: 'new-2',
          firebaseUid: 'fb-new',
          email: 'worker@company.com',
          status: 'PENDING_SETUP',
          isActive: false,
        }) as never,
      );

      await expect(
        service.loginWithFirebase({
          firebaseUid: 'fb-new',
          email: 'worker@company.com',
          displayName: null,
          photoURL: null,
          workstationId: 'ws-2',
        }),
      ).rejects.toThrow(AccountInactiveException);
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
    });

    it('links an existing local account (matched by email) to the Firebase uid', async () => {
      const local = buildPrismaUser({
        id: 'local-1',
        email: 'local@example.com',
        firebaseUid: null,
        authMethod: 'PASSWORD',
        passwordHash: null,
      });
      prisma.user.findFirst.mockResolvedValueOnce(null as never).mockResolvedValueOnce(local as never);
      prisma.user.update.mockResolvedValueOnce({ ...local, firebaseUid: 'fb-link' } as never);

      const result = await service.loginWithFirebase({
        firebaseUid: 'fb-link',
        email: 'local@example.com',
        displayName: 'Local',
        photoURL: null,
        workstationId: 'ws-3',
      });

      const linkingCall = (prisma.user.update as jest.Mock).mock.calls.find(
        (c) => c[0].data.firebaseUid === 'fb-link',
      );
      expect(linkingCall).toBeDefined();
      expect(linkingCall![0].data.authMethod).toBe('OAUTH_GOOGLE');
      expect(result.user.id).toBe('local-1');
    });

    it('throws FirebaseEmailConflictException when the verified email collides with a password account', async () => {
      prisma.user.findFirst
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce(
          buildPrismaUser({
            id: 'pw-1',
            email: 'collide@example.com',
            passwordHash: 'hash',
            firebaseUid: null,
          }) as never,
        );

      await expect(
        service.loginWithFirebase({
          firebaseUid: 'fb-x',
          email: 'collide@example.com',
          displayName: null,
          photoURL: null,
          workstationId: 'ws-4',
        }),
      ).rejects.toThrow(FirebaseEmailConflictException);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('throws FirebaseEmailConflictException (HTTP 409) when the verified email matches an account linked to a different firebaseUid', async () => {
      const otherGoogle = buildPrismaUser({
        id: 'other-g-1',
        email: 'shared@example.com',
        passwordHash: null,
        firebaseUid: 'fb-other',
        authMethod: 'OAUTH_GOOGLE',
      });
      prisma.user.findFirst
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce(otherGoogle as never);

      await expect(
        service.loginWithFirebase({
          firebaseUid: 'fb-ours',
          email: 'shared@example.com',
          displayName: null,
          photoURL: null,
          workstationId: 'ws-5',
        }),
      ).rejects.toMatchObject({ status: 409 });

      expect(sessionService.createSession).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('bootstrapSaasAdmin', () => {
    it('creates an ACTIVE SAAS_ADMIN with PASSWORD_ONLY auth and audits it', async () => {
      prisma.user.findFirst.mockResolvedValueOnce(null as never);
      const created = buildPrismaUser({
        id: 'saas-1',
        email: 'root@company.com',
        role: 'SAAS_ADMIN',
        authMethod: 'PASSWORD_ONLY',
      });
      prisma.user.create.mockResolvedValueOnce(created as never);

      const result = await service.bootstrapSaasAdmin({
        email: 'root@company.com',
        displayName: 'Root',
      });

      const callData = (prisma.user.create as jest.Mock).mock.calls[0][0].data;
      expect(callData.role).toBe('SAAS_ADMIN');
      expect(callData.status).toBe('ACTIVE');
      expect(callData.isActive).toBe(true);
      expect(callData.authMethod).toBe('PASSWORD_ONLY');
      expect(callData.emailVerifiedAt).toEqual(expect.any(Date));
      expect(callData.fullName).toBe('Root');
      expect(result.id).toBe('saas-1');
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('pinHash');
      expect(auditService.log).toHaveBeenCalledWith(AuditEvent.USER_CREATED, {
        actorId: null,
        actorRole: null,
        targetType: 'User',
        targetId: 'saas-1',
        details: {
          role: 'SAAS_ADMIN',
          source: 'bootstrap',
          promoted: false,
        },
      });
    });

    it('promotes an existing user by email instead of creating a duplicate', async () => {
      prisma.user.findFirst.mockResolvedValueOnce(
        buildPrismaUser({
          id: 'owner-1',
          email: 'root@company.com',
          role: 'OWNER',
        }) as never,
      );
      prisma.user.update.mockResolvedValueOnce(
        buildPrismaUser({
          id: 'owner-1',
          email: 'root@company.com',
          role: 'SAAS_ADMIN',
        }) as never,
      );

      const result = await service.bootstrapSaasAdmin({
        email: 'ROOT@COMPANY.COM',
      });

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'owner-1' },
        data: expect.objectContaining({
          role: 'SAAS_ADMIN',
          status: 'ACTIVE',
          isActive: true,
          authMethod: 'PASSWORD_ONLY',
        }),
      });
      expect(result.id).toBe('owner-1');
      expect(auditService.log).toHaveBeenCalledWith(
        AuditEvent.USER_CREATED,
        expect.objectContaining({
          details: expect.objectContaining({ promoted: true }),
        }),
      );
    });
  });

  describe('login', () => {
    it('returns a user DTO without passwordHash or passwordAlgorithm even when the stored account has credential material', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildPrismaUser({
          id: 'user-1',
          passwordHash: 'stored-argon2-hash',
          passwordAlgorithm: 'argon2id',
        }) as never,
      );

      const result = await service.login({
        identifier: 'user@example.com',
        secret: 'pw',
        sessionType: 'PASSWORD',
        workstationId: 'ws-1',
      });

      expect(result.user.id).toBe('user-1');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('passwordAlgorithm');
    });
  });

  describe('login (WEB_ADMIN workstation fallback)', () => {
    it('resolves the WEB_ADMIN virtual workstation and passes its id into session creation', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildPrismaUser({ id: 'user-1', passwordHash: 'hash' }) as never,
      );
      prisma.workstation.upsert.mockResolvedValue({ id: 'ws-web-admin' } as never);

      await service.login({
        identifier: 'user@example.com',
        secret: 'pw',
        sessionType: 'PASSWORD',
      });

      expect(prisma.workstation.upsert).toHaveBeenCalledWith({
        where: { code: 'WEB_ADMIN' },
        create: expect.objectContaining({
          name: 'Web Admin',
          code: 'WEB_ADMIN',
          isActive: true,
          registeredAt: expect.any(Date),
        }),
        update: {},
        select: { id: true },
      });
      expect(sessionService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ workstationId: 'ws-web-admin', userId: 'user-1' }),
      );
    });

    it('uses the supplied workstationId without upserting WEB_ADMIN', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildPrismaUser({ id: 'user-1', passwordHash: 'hash' }) as never,
      );

      await service.login({
        identifier: 'user@example.com',
        secret: 'pw',
        sessionType: 'PASSWORD',
        workstationId: 'ws-pos-1',
      });

      expect(prisma.workstation.upsert).not.toHaveBeenCalled();
      expect(sessionService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ workstationId: 'ws-pos-1', userId: 'user-1' }),
      );
    });
  });

  describe('loginWithFirebase (WEB_ADMIN workstation fallback)', () => {
    it('resolves the WEB_ADMIN virtual workstation when no workstationId is supplied', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildPrismaUser({ id: 'user-1' }) as never,
      );
      prisma.workstation.upsert.mockResolvedValue({ id: 'ws-web-admin' } as never);

      await service.loginWithFirebase({
        firebaseUid: 'fb-uid-1',
        email: 'existing@example.com',
        displayName: null,
        photoURL: null,
      });

      expect(prisma.workstation.upsert).toHaveBeenCalledWith({
        where: { code: 'WEB_ADMIN' },
        create: expect.objectContaining({
          name: 'Web Admin',
          code: 'WEB_ADMIN',
          isActive: true,
          registeredAt: expect.any(Date),
        }),
        update: {},
        select: { id: true },
      });
      expect(sessionService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ workstationId: 'ws-web-admin', userId: 'user-1' }),
      );
    });

    it('uses the supplied workstationId without upserting WEB_ADMIN', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildPrismaUser({ id: 'user-1' }) as never,
      );

      await service.loginWithFirebase({
        firebaseUid: 'fb-uid-1',
        email: 'existing@example.com',
        displayName: null,
        photoURL: null,
        workstationId: 'ws-firebase-1',
      });

      expect(prisma.workstation.upsert).not.toHaveBeenCalled();
      expect(sessionService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ workstationId: 'ws-firebase-1', userId: 'user-1' }),
      );
    });
  });

  describe('login (workstation self-registration)', () => {
    it('self-registers an unknown workstationId inside a transaction, acquiring the advisory lock before creating', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildPrismaUser({ id: 'user-1', passwordHash: 'hash' }) as never,
      );
      // Outer lookup and in-tx re-check both find nothing; no code/name clashes.
      prisma.workstation.findUnique.mockResolvedValue(null as never);
      tx.workstation.findUnique.mockResolvedValue(null as never);
      tx.workstation.findFirst.mockResolvedValue(null as never);
      tx.workstation.create.mockResolvedValue({
        id: 'ws-new-1',
        name: 'POS N-1',
      } as never);

      await service.login({
        identifier: 'user@example.com',
        secret: 'pw',
        sessionType: 'PASSWORD',
        workstationId: 'ws-new-1',
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      const lockCallOrder = (tx.$executeRaw as jest.Mock).mock
        .invocationCallOrder[0];
      const createCallOrder = (tx.workstation.create as jest.Mock).mock
        .invocationCallOrder[0];
      expect(lockCallOrder).toBeLessThan(createCallOrder);
      expect(tx.workstation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: 'ws-new-1',
            code: expect.stringMatching(/^AUTO-[0-9A-F]{6}$/),
            isActive: true,
            registeredAt: expect.any(Date),
          }),
        }),
      );
      expect(sessionService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ workstationId: 'ws-new-1', userId: 'user-1' }),
      );
    });

    it('does not open a transaction when the supplied workstationId already exists', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildPrismaUser({ id: 'user-1', passwordHash: 'hash' }) as never,
      );
      // beforeEach default resolves findUnique({ where: { id } }) to a row.

      await service.login({
        identifier: 'user@example.com',
        secret: 'pw',
        sessionType: 'PASSWORD',
        workstationId: 'ws-known-1',
      });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.workstation.create).not.toHaveBeenCalled();
      expect(sessionService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workstationId: 'ws-known-1',
          userId: 'user-1',
        }),
      );
    });

    it('skips creation when the in-transaction re-check finds the workstation created by a racing login', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildPrismaUser({ id: 'user-1', passwordHash: 'hash' }) as never,
      );
      // Outer lookup misses, but the re-check inside the transaction wins.
      prisma.workstation.findUnique.mockResolvedValue(null as never);
      tx.workstation.findUnique.mockResolvedValue({ id: 'ws-raced' } as never);

      await service.login({
        identifier: 'user@example.com',
        secret: 'pw',
        sessionType: 'PASSWORD',
        workstationId: 'ws-raced',
      });

      expect(tx.workstation.create).not.toHaveBeenCalled();
      expect(sessionService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ workstationId: 'ws-raced' }),
      );
    });

    it('uses the requested workstation name verbatim when it is free', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildPrismaUser({ id: 'user-1', passwordHash: 'hash' }) as never,
      );
      prisma.workstation.findUnique.mockResolvedValue(null as never);
      tx.workstation.findUnique.mockResolvedValue(null as never);
      tx.workstation.findFirst.mockResolvedValue(null as never);
      tx.workstation.create.mockResolvedValue({
        id: 'ws-caja',
        name: 'Caja Principal',
      } as never);

      await service.login({
        identifier: 'user@example.com',
        secret: 'pw',
        sessionType: 'PASSWORD',
        workstationId: 'ws-caja-ab12cd34',
        workstationName: 'Caja Principal',
      });

      expect(tx.workstation.findFirst).toHaveBeenCalledWith({
        where: { name: 'Caja Principal' },
        select: { id: true },
      });
      expect(tx.workstation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Caja Principal' }),
        }),
      );
    });

    it('falls back to the POS id fragment when the requested name is taken', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildPrismaUser({ id: 'user-1', passwordHash: 'hash' }) as never,
      );
      prisma.workstation.findUnique.mockResolvedValue(null as never);
      tx.workstation.findUnique.mockResolvedValue(null as never);
      // First candidate ('Caja Principal') clashes; 'POS CD34' is free.
      tx.workstation.findFirst
        .mockResolvedValueOnce({ id: 'other-ws' } as never)
        .mockResolvedValue(null as never);
      tx.workstation.create.mockResolvedValue({
        id: 'ws-caja-ab12cd34',
        name: 'POS CD34',
      } as never);

      await service.login({
        identifier: 'user@example.com',
        secret: 'pw',
        sessionType: 'PASSWORD',
        workstationId: 'ws-caja-ab12cd34',
        workstationName: 'Caja Principal',
      });

      expect(tx.workstation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'POS CD34' }),
        }),
      );
    });

    it('suffixes the requested name with the id fragment when every candidate clashes', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildPrismaUser({ id: 'user-1', passwordHash: 'hash' }) as never,
      );
      prisma.workstation.findUnique.mockResolvedValue(null as never);
      tx.workstation.findUnique.mockResolvedValue(null as never);
      // Both candidates taken.
      tx.workstation.findFirst.mockResolvedValue({ id: 'other-ws' } as never);
      tx.workstation.create.mockResolvedValue({
        id: 'ws-caja-ab12cd34',
        name: 'Caja Principal (CD34)',
      } as never);

      await service.login({
        identifier: 'user@example.com',
        secret: 'pw',
        sessionType: 'PASSWORD',
        workstationId: 'ws-caja-ab12cd34',
        workstationName: 'Caja Principal',
      });

      expect(tx.workstation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Caja Principal (CD34)' }),
        }),
      );
    });

    it('retries code generation past collisions until an unused AUTO- code is found', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildPrismaUser({ id: 'user-1', passwordHash: 'hash' }),
      );
      prisma.workstation.findUnique.mockResolvedValue(null as never);
      const seenCodes: string[] = [];
      // The in-tx re-check runs first (lookup by id); after two code
      // candidates clash, the third is accepted.
      tx.workstation.findUnique.mockImplementation(async (args: any) => {
        if (args.where.id !== undefined) return null;
        seenCodes.push(args.where.code);
        return seenCodes.length <= 2 ? { id: 'other-ws' } : null;
      });
      tx.workstation.findFirst.mockResolvedValue(null as never);
      tx.workstation.create.mockResolvedValue({
        id: 'ws-collide',
        name: 'POS LIDE',
      } as never);

      await service.login({
        identifier: 'user@example.com',
        secret: 'pw',
        sessionType: 'PASSWORD',
        workstationId: 'ws-collide',
      });

      expect(seenCodes.length).toBe(3);
      expect(seenCodes[0]).not.toBe(seenCodes[1]);
      expect(seenCodes[1]).not.toBe(seenCodes[2]);
      expect(tx.workstation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            // The create must use the accepted third candidate, not a fresh one.
            code: seenCodes[2],
          }),
        }),
      );
    });
  });

  describe('loginWithFirebase (workstation self-registration)', () => {
    it('self-registers an unknown workstationId the same way password login does', async () => {
      const existing = buildPrismaUser({
        id: 'fb-user-1',
        firebaseUid: 'fb-uid-1',
        email: 'existing@example.com',
      });
      prisma.user.findFirst.mockResolvedValue(existing as never);
      prisma.workstation.findUnique.mockResolvedValue(null as never);
      tx.workstation.findUnique.mockResolvedValue(null as never);
      tx.workstation.findFirst.mockResolvedValue(null as never);
      tx.workstation.create.mockResolvedValue({
        id: 'ws-fb-new',
        name: 'Caja Firebase',
      } as never);

      const result = await service.loginWithFirebase({
        firebaseUid: 'fb-uid-1',
        email: 'existing@example.com',
        displayName: null,
        photoURL: null,
        workstationId: 'ws-fb-new',
        workstationName: 'Caja Firebase',
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.workstation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: 'ws-fb-new',
            name: 'Caja Firebase',
            isActive: true,
          }),
        }),
      );
      expect(result.accessToken).toBe('signed-jwt');
      expect(result.user.id).toBe('fb-user-1');
    });
  });

  describe('refreshSession', () => {
    const session = { id: 'session-1', userId: 'user-1', workstationId: 'ws-1' };

    it('rotates both tokens and extends the session using the refresh TTL', async () => {
      sessionService.findActiveSessionByTokenHash.mockResolvedValue(session);

      const result = await service.refreshSession('old-hash', 'user-1');

      expect(sessionService.findActiveSessionByTokenHash).toHaveBeenCalledWith('old-hash');
      expect(jwtService.sign).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          sub: 'user-1',
          tokenHash: expect.any(String),
          sessionId: 'session-1',
        }),
        { expiresIn: 900 },
      );
      expect(jwtService.sign).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          sub: 'user-1',
          refreshTokenHash: expect.any(String),
          sessionId: 'session-1',
        }),
        { expiresIn: 604800 },
      );

      expect(sessionService.updateSessionTokens).toHaveBeenCalledTimes(1);
      const updateCall = (sessionService.updateSessionTokens as jest.Mock).mock.calls[0];
      expect(updateCall[0]).toBe('session-1');
      expect(updateCall[1]).toEqual(expect.any(String));
      expect(updateCall[2]).toEqual(expect.any(String));
      const refreshExpiresAt = updateCall[3] as Date;
      expect(refreshExpiresAt.getTime()).toBeGreaterThanOrEqual(
        Date.now() + 604800 * 1000 - 5000,
      );
      expect(refreshExpiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 604800 * 1000 + 5000,
      );

      expect(result.accessToken).toBe('signed-jwt');
      expect(result.refreshToken).toBe('signed-jwt');
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
        Date.now() + 900 * 1000 - 5000,
      );
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 900 * 1000 + 5000,
      );
      expect(auditService.log).toHaveBeenCalledWith(
        AuditEvent.REFRESH_TOKEN,
        expect.objectContaining({ actorId: 'user-1', sessionId: 'session-1' }),
      );
    });

    it('rotates tokens without a userId when none is supplied', async () => {
      sessionService.findActiveSessionByTokenHash.mockResolvedValue(session);

      const result = await service.refreshSession('old-hash');

      expect(result.accessToken).toBe('signed-jwt');
      expect(sessionService.updateSessionTokens).toHaveBeenCalledTimes(1);
    });

    it('throws SessionExpiredException when the session belongs to a different user', async () => {
      sessionService.findActiveSessionByTokenHash.mockResolvedValue(session);

      await expect(
        service.refreshSession('old-hash', 'user-other'),
      ).rejects.toThrow(SessionExpiredException);

      expect(sessionService.updateSessionTokens).not.toHaveBeenCalled();
      expect(jwtService.sign).not.toHaveBeenCalled();
      expect(prisma.userSession.findFirst).not.toHaveBeenCalled();
    });

    it('throws SessionExpiredException without revoking when no active session and no reuse match exists', async () => {
      sessionService.findActiveSessionByTokenHash.mockResolvedValue(null);
      prisma.userSession.findFirst.mockResolvedValue(null);

      await expect(service.refreshSession('old-hash')).rejects.toThrow(
        SessionExpiredException,
      );

      expect(prisma.userSession.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ refreshTokenHash: 'old-hash' }, { tokenHash: 'old-hash' }],
        },
      });
      expect(sessionService.revokeUserSessions).not.toHaveBeenCalled();
    });

    it('throws SessionExpiredException without revoking when the reuse lookup finds an active session', async () => {
      sessionService.findActiveSessionByTokenHash.mockResolvedValue(null);
      prisma.userSession.findFirst.mockResolvedValue({
        id: 's-1',
        userId: 'u-1',
        status: 'ACTIVE',
      });

      await expect(service.refreshSession('old-hash')).rejects.toThrow(
        SessionExpiredException,
      );

      expect(sessionService.revokeUserSessions).not.toHaveBeenCalled();
    });

    it('revokes all user sessions when the old token matches a REVOKED session (reuse detection)', async () => {
      sessionService.findActiveSessionByTokenHash.mockResolvedValue(null);
      prisma.userSession.findFirst.mockResolvedValue({
        id: 's-old',
        userId: 'u-1',
        status: 'REVOKED',
      });

      await expect(service.refreshSession('old-hash')).rejects.toThrow(
        SessionExpiredException,
      );

      expect(sessionService.revokeUserSessions).toHaveBeenCalledWith(
        'u-1',
        SessionRevocationReason.SECURITY_ANOMALY,
      );
      expect(auditService.log).toHaveBeenCalledWith(
        AuditEvent.REVOKED_REFRESH_REUSE,
        expect.objectContaining({
          actorId: 'u-1',
          sessionId: 's-old',
          details: { tokenReuse: true },
        }),
      );
      expect(jwtService.sign).not.toHaveBeenCalled();
    });
  });

  describe('validateActiveSession', () => {
    it('returns a user DTO without passwordHash or passwordAlgorithm even when the stored account has credential material', async () => {
      sessionService.findActiveSessionByTokenHash.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        workstationId: 'ws-1',
      });
      prisma.user.findUnique.mockResolvedValue(
        buildPrismaUser({
          id: 'user-1',
          passwordHash: 'stored-argon2-hash',
          passwordAlgorithm: 'argon2id',
        }) as never,
      );

      const result = await service.validateActiveSession('user-1', 'token-hash');

      expect(result.id).toBe('user-1');
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('passwordAlgorithm');
    });
  });

  describe('getActiveUser', () => {
    it('returns a user DTO without passwordHash or passwordAlgorithm even when the stored account has credential material', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildPrismaUser({
          id: 'user-1',
          passwordHash: 'stored-argon2-hash',
          passwordAlgorithm: 'argon2id',
        }) as never,
      );

      const result = await service.getActiveUser('user-1');

      expect(result.id).toBe('user-1');
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('passwordAlgorithm');
    });
  });
});