import { jest, describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';
import { FirebaseEmailConflictException } from './exceptions/firebase-email-conflict.exception';

jest.unstable_mockModule('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.unstable_mockModule('@pharmacy/database', () => ({
  PrismaClient: class {},
  Prisma: {},
  UserStatus: {
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE',
    PENDING_SETUP: 'PENDING_SETUP',
    DISABLED: 'DISABLED',
    LOCKED: 'LOCKED',
  },
  SessionRevocationReason: {
    SECURITY_ANOMALY: 'SECURITY_ANOMALY',
    LOGOUT: 'LOGOUT',
    PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  },
}));
jest.unstable_mockModule('./services/password-hasher.service', () => ({
  PasswordHasherService: class {},
}));
jest.unstable_mockModule('./services/pin.service', () => ({ PinService: class {} }));
jest.unstable_mockModule('./services/totp.service', () => ({ TotpService: class {} }));
jest.unstable_mockModule('./services/backup-codes.service', () => ({
  BackupCodesService: class {},
}));
jest.unstable_mockModule('./services/session.service', () => ({ SessionService: class {} }));
jest.unstable_mockModule('./services/audit.service', () => ({
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
  },
}));
jest.unstable_mockModule('./offline/offline-token.service', () => ({
  OfflineTokenService: class {},
}));
jest.unstable_mockModule('./offline/credential-cache.service', () => ({
  CredentialCacheService: class {},
}));

let AuthService: typeof import('./auth.service').AuthService;

beforeAll(async () => {
  ({ AuthService } = await import('./auth.service'));
});

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

describe('AuthService.loginWithFirebase', () => {
  let prisma: MockProxy<PrismaClient>;
  let service: InstanceType<typeof AuthService>;
  let jwtService: { sign: jest.Mock };
  let configService: { get: jest.Mock };
  let sessionService: {
    createSession: jest.Mock;
    enforceSessionLimit: jest.Mock;
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
    sessionService = {
      createSession: jest.fn().mockResolvedValue({ id: 'session-1' }),
      enforceSessionLimit: jest.fn().mockResolvedValue({ evictedSessionId: null }),
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

    service = new AuthService(
      prisma as unknown as PrismaClient,
      jwtService as never,
      configService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      sessionService as never,
      auditService as never,
      offlineTokenService as never,
      credentialCacheService as never,
    );
  });

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

  it('creates a new OWNER/OAUTH_GOOGLE user when no local account matches', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(null as never).mockResolvedValueOnce(null as never);
    const created = buildPrismaUser({
      id: 'new-1',
      firebaseUid: 'fb-new',
      email: 'new@example.com',
      authMethod: 'OAUTH_GOOGLE',
      role: 'OWNER',
    });
    prisma.user.create.mockResolvedValueOnce(created as never);

    const result = await service.loginWithFirebase({
      firebaseUid: 'fb-new',
      email: 'new@example.com',
      displayName: 'New Person',
      photoURL: 'https://photo.example.com/p.png',
      workstationId: 'ws-2',
    });

    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    const callData = (prisma.user.create as jest.Mock).mock.calls[0][0].data;
    expect(callData.role).toBe('OWNER');
    expect(callData.authMethod).toBe('OAUTH_GOOGLE');
    expect(callData.firebaseUid).toBe('fb-new');
    expect(callData.isActive).toBe(true);
    expect(callData.email).toBe('new@example.com');
    expect(callData.fullName).toBe('New Person');
    expect(callData.displayName).toBe('New Person');
    expect(callData.avatarUrl).toBe('https://photo.example.com/p.png');
    expect(result.user.id).toBe('new-1');
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
