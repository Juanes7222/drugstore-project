import { jest, describe, it, expect, beforeAll, beforeEach } from '@jest/globals';

jest.unstable_mockModule('firebase-admin/app', () => ({
  initializeApp: jest.fn(() => ({})),
  cert: jest.fn(() => ({})),
}));
jest.unstable_mockModule('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));

let FirebaseAuthService: typeof import('./firebase-auth.service').FirebaseAuthService;
let getAuth: typeof import('firebase-admin/auth').getAuth;

beforeAll(async () => {
  ({ FirebaseAuthService } = await import('./firebase-auth.service'));
  ({ getAuth } = await import('firebase-admin/auth'));
});

describe('FirebaseAuthService', () => {
  let service: InstanceType<typeof FirebaseAuthService>;
  let configService: { get: jest.Mock };
  let mockAuth: {
    verifyIdToken: jest.Mock;
    getUser: jest.Mock;
    createUser: jest.Mock;
  };

  beforeEach(() => {
    configService = { get: jest.fn() };
    service = new FirebaseAuthService(configService as never);
    mockAuth = {
      verifyIdToken: jest.fn(),
      getUser: jest.fn(),
      createUser: jest.fn(),
    };
    (getAuth as unknown as jest.Mock).mockReturnValue(mockAuth);
  });

  describe('onModuleInit / isConfigured', () => {
    it('reports not configured when FIREBASE_SERVICE_ACCOUNT is undefined', () => {
      configService.get.mockReturnValue(undefined);

      service.onModuleInit();

      expect(service.isConfigured).toBe(false);
    });

    it('throws from verifyIdToken when not configured', async () => {
      configService.get.mockReturnValue(undefined);
      service.onModuleInit();

      await expect(service.verifyIdToken('some-token')).rejects.toThrow(
        'Firebase is not configured on the server',
      );
    });

    it('reports configured when a service account JSON is present', () => {
      configService.get.mockReturnValue(
        JSON.stringify({
          project_id: 'demo-project',
          client_email: 'firebase@demo-project.iam.gserviceaccount.com',
          private_key: '-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----\n',
        }),
      );

      service.onModuleInit();

      expect(service.isConfigured).toBe(true);
    });
  });

  describe('verifyIdToken', () => {
    beforeEach(() => {
      configService.get.mockReturnValue(
        JSON.stringify({ project_id: 'demo-project', client_email: 'x', private_key: 'y' }),
      );
      service.onModuleInit();
    });

    it('maps decoded Google claims onto the expected shape', async () => {
      mockAuth.verifyIdToken.mockResolvedValue({
        uid: 'uid-123',
        email: 'user@example.com',
        name: 'Display Name',
        picture: 'https://photo.example.com/p.png',
        email_verified: true,
      } as never);

      const result = await service.verifyIdToken('id-token');

      expect(result).toEqual({
        uid: 'uid-123',
        email: 'user@example.com',
        displayName: 'Display Name',
        photoURL: 'https://photo.example.com/p.png',
        emailVerified: true,
      });
    });

    it('falls back to null for absent email/name/picture and false for unverified email', async () => {
      mockAuth.verifyIdToken.mockResolvedValue({ uid: 'uid-456' } as never);

      const result = await service.verifyIdToken('id-token');

      expect(result).toEqual({
        uid: 'uid-456',
        email: null,
        displayName: null,
        photoURL: null,
        emailVerified: false,
      });
    });
  });

  describe('getOrCreateUserRecord', () => {
    beforeEach(() => {
      configService.get.mockReturnValue(
        JSON.stringify({ project_id: 'demo-project', client_email: 'x', private_key: 'y' }),
      );
      service.onModuleInit();
    });

    it('returns the existing Firebase user record when present', async () => {
      const existing = { uid: 'uid-789', email: 'found@example.com' } as never;
      mockAuth.getUser.mockResolvedValue(existing);

      const result = await service.getOrCreateUserRecord('uid-789', 'found@example.com');

      expect(result).toBe(existing);
      expect(mockAuth.createUser).not.toHaveBeenCalled();
    });

    it('creates the Firebase user record when getUser fails', async () => {
      const created = { uid: 'uid-new', email: 'new@example.com' } as never;
      mockAuth.getUser.mockRejectedValue(new Error('user-not-found'));
      mockAuth.createUser.mockResolvedValue(created);

      const result = await service.getOrCreateUserRecord('uid-new', 'new@example.com');

      expect(result).toBe(created);
      expect(mockAuth.createUser).toHaveBeenCalledWith({
        uid: 'uid-new',
        email: 'new@example.com',
      });
    });
  });
});
