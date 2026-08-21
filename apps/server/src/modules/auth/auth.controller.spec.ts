import { jest, describe, it, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';

jest.unstable_mockModule('./auth.service', () => ({ AuthService: class {} }));
jest.unstable_mockModule('./services/firebase-auth.service', () => ({
  FirebaseAuthService: class {},
}));
jest.unstable_mockModule('./services/session.service', () => ({
  SessionService: class {},
}));
jest.unstable_mockModule('@/common/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class {},
}));
jest.unstable_mockModule('@/common/guards/roles.guard', () => ({
  RolesGuard: class {},
}));
jest.unstable_mockModule('@pharmacy/database', () => ({
  PrismaClient: class {},
  Prisma: {},
  UserStatus: { ACTIVE: 'ACTIVE' },
  SessionRevocationReason: { LOGOUT: 'LOGOUT' },
  UserSession: class {},
}));

let AuthController: typeof import('./auth.controller').AuthController;
let AuthService: typeof import('./auth.service').AuthService;
let FirebaseAuthService: typeof import('./services/firebase-auth.service').FirebaseAuthService;
let SessionService: typeof import('./services/session.service').SessionService;

beforeAll(async () => {
  ({ AuthController } = await import('./auth.controller'));
  ({ AuthService } = await import('./auth.service'));
  ({ FirebaseAuthService } = await import('./services/firebase-auth.service'));
  ({ SessionService } = await import('./services/session.service'));
});

function buildAuthResponseData(): any {
  return {
    accessToken: 'at-123',
    refreshToken: 'rt-123',
    expiresAt: new Date(0),
    user: {
      id: 'resp-user',
      role: 'OWNER',
      authMethod: 'OAUTH_GOOGLE',
      email: 'e@e.com',
      isActive: true,
    },
    sessionId: 'sess-1',
    offlineToken: { token: 'ot-1', expiresAt: new Date(0) },
    credentialVerificationKey: {
      encryptedBlob: 'b',
      keyFingerprint: 'fp',
      version: 1,
    },
  };
}

describe('AuthController (Firebase flow)', () => {
  let app: INestApplication;
  let authServiceMock: { loginWithFirebase: jest.Mock };
  let firebaseAuthMock: { isConfigured: boolean; verifyIdToken: jest.Mock };
  let configServiceMock: { get: jest.Mock };

  beforeEach(async () => {
    authServiceMock = { loginWithFirebase: jest.fn() };
    firebaseAuthMock = {
      isConfigured: true,
      verifyIdToken: jest
        .fn()
        .mockResolvedValue({
          uid: 'u1',
          email: 'e@e.com',
          displayName: 'DN',
          photoURL: 'pu',
          emailVerified: true,
        }),
    };
    configServiceMock = { get: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: FirebaseAuthService, useValue: firebaseAuthMock },
        { provide: SessionService, useValue: {} },
        { provide: JwtService, useValue: { sign: jest.fn(), decode: jest.fn() } },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /auth/firebase/config', () => {
    it('returns the env-derived public config', async () => {
      configServiceMock.get.mockImplementation(
        (k: string) =>
          ({
            FIREBASE_API_KEY: 'ak',
            FIREBASE_AUTH_DOMAIN: 'ad',
            FIREBASE_PROJECT_ID: 'pid',
            FIREBASE_STORAGE_BUCKET: 'sb',
            FIREBASE_MESSAGING_SENDER_ID: 'msi',
            FIREBASE_APP_ID: 'aid',
            FIREBASE_MEASUREMENT_ID: 'mid',
          })[k] ?? null,
      );

      const res = await request(app.getHttpServer()).get(
        '/auth/firebase/config',
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        apiKey: 'ak',
        authDomain: 'ad',
        projectId: 'pid',
        storageBucket: 'sb',
        messagingSenderId: 'msi',
        appId: 'aid',
        measurementId: 'mid',
      });
    });

    it('returns nulls when the config keys are unset', async () => {
      configServiceMock.get.mockReturnValue(null);

      const res = await request(app.getHttpServer()).get(
        '/auth/firebase/config',
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        apiKey: null,
        authDomain: null,
        projectId: null,
        storageBucket: null,
        messagingSenderId: null,
        appId: null,
        measurementId: null,
      });
    });
  });

  describe('POST /auth/login/firebase', () => {
    it('returns 503 when Firebase is not configured', async () => {
      firebaseAuthMock.isConfigured = false;

      const res = await request(app.getHttpServer())
        .post('/auth/login/firebase')
        .send({ idToken: 'tok', workstationId: 'ws' });

      expect(res.status).toBe(503);
      expect(res.body.message).toContain('Google sign-in is not enabled');
      expect(firebaseAuthMock.verifyIdToken).not.toHaveBeenCalled();
    });

    it('returns the AuthResponseDto shape on the happy path', async () => {
      firebaseAuthMock.isConfigured = true;
      const data = buildAuthResponseData();
      authServiceMock.loginWithFirebase.mockResolvedValue(data);

      const res = await request(app.getHttpServer())
        .post('/auth/login/firebase')
        .set('x-forwarded-for', '1.2.3.4')
        .send({ idToken: 'tok', workstationId: 'ws' });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBe('at-123');
      expect(res.body.user.id).toBe('resp-user');
      expect(res.body.offlineToken).toEqual({
        token: 'ot-1',
        expiresAt: '1970-01-01T00:00:00.000Z',
      });
      expect(authServiceMock.loginWithFirebase).toHaveBeenCalledWith(
        expect.objectContaining({
          firebaseUid: 'u1',
          email: 'e@e.com',
          displayName: 'DN',
          photoURL: 'pu',
          workstationId: 'ws',
          ipAddress: '1.2.3.4',
        }),
      );
    });
  });
});
