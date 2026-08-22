// jest.mock factories are used instead of jest.unstable_mockModule: the
// latter does not register in this Jest/ts-jest ESM setup.
jest.mock('./auth.service', () => ({ AuthService: class {} }));
jest.mock('./services/firebase-auth.service', () => ({
  FirebaseAuthService: class {},
}));
jest.mock('./services/session.service', () => ({ SessionService: class {} }));
jest.mock('@/common/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class {},
}));
jest.mock('@/common/guards/roles.guard', () => ({ RolesGuard: class {} }));
jest.mock('./guards/jwt-refresh.guard', () => ({ JwtRefreshGuard: class {} }));
jest.mock('@pharmacy/database', () => ({
  PrismaClient: class {},
  Prisma: {},
  UserStatus: { ACTIVE: 'ACTIVE' },
  SessionRevocationReason: { LOGOUT: 'LOGOUT' },
  UserSession: class {},
}));

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { FirebaseAuthService } from './services/firebase-auth.service';
import { SessionService } from './services/session.service';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';

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

describe('AuthController', () => {
  let app: INestApplication;
  let authServiceMock: { loginWithFirebase: jest.Mock; refreshSession: jest.Mock };
  let firebaseAuthMock: { isConfigured: boolean; verifyIdToken: jest.Mock };
  let configServiceMock: { get: jest.Mock };
  let jwtServiceMock: { sign: jest.Mock; decode: jest.Mock };

  beforeEach(async () => {
    authServiceMock = { loginWithFirebase: jest.fn(), refreshSession: jest.fn() };
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
    jwtServiceMock = { sign: jest.fn(), decode: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: FirebaseAuthService, useValue: firebaseAuthMock },
        { provide: SessionService, useValue: {} },
        { provide: JwtService, useValue: jwtServiceMock },
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

  describe('POST /auth/refresh', () => {
    it('is protected by the JwtRefreshGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        AuthController.prototype.refresh,
      ) as unknown[];

      expect(guards).toContain(JwtRefreshGuard);
    });

    it('decodes the bearer token and calls refreshSession with tokenHash and sub', async () => {
      jwtServiceMock.decode.mockReturnValue({ sub: 'user-1', tokenHash: 'th-1' });
      authServiceMock.refreshSession.mockResolvedValue({
        accessToken: 'at-2',
        refreshToken: 'rt-2',
        expiresAt: new Date(0),
      });

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Authorization', 'Bearer some.jwt.token');

      expect(res.status).toBe(200);
      expect(authServiceMock.refreshSession).toHaveBeenCalledWith('th-1', 'user-1');
      expect(res.body).toEqual({
        accessToken: 'at-2',
        refreshToken: 'rt-2',
        expiresAt: '1970-01-01T00:00:00.000Z',
      });
    });

    it('returns 401 when the Authorization header is missing', async () => {
      const res = await request(app.getHttpServer()).post('/auth/refresh');

      expect(res.status).toBe(401);
      expect(jwtServiceMock.decode).not.toHaveBeenCalled();
      expect(authServiceMock.refreshSession).not.toHaveBeenCalled();
    });
  });
});