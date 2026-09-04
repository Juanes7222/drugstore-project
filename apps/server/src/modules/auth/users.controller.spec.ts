import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RoleType, type User } from '@pharmacy/shared-types';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { createPrismaDatabaseMock } from '../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());
jest.mock('./services/pin.service', () => ({ PinService: class {} }));
jest.mock('./services/password-hasher.service', () => ({
  PasswordHasherService: class {},
}));
jest.mock('./services/session.service', () => ({ SessionService: class {} }));
jest.mock('./services/audit.service', () => ({
  AuditService: class {},
  AuditEvent: {
    USER_CREATED: 'USER_CREATED',
    USER_UPDATED: 'USER_UPDATED',
    USER_DELETED: 'USER_DELETED',
    USER_DISABLED: 'USER_DISABLED',
    USER_ENABLED: 'USER_ENABLED',
    USER_APPROVED: 'USER_APPROVED',
    USER_UNLOCKED: 'USER_UNLOCKED',
    PIN_RESET: 'PIN_RESET',
    SESSION_REVOKED: 'SESSION_REVOKED',
  },
}));
jest.mock('./offline/offline-token.service', () => ({
  OfflineTokenService: class {},
}));
jest.mock('./auth.service', () => ({ AuthService: class {} }));

import { UsersController } from './users.controller';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PinService } from './services/pin.service';
import { PasswordHasherService } from './services/password-hasher.service';
import { SessionService } from './services/session.service';
import { AuditService, AuditEvent } from './services/audit.service';
import { OfflineTokenService } from './offline/offline-token.service';
import { AuthService } from './auth.service';

function buildActor(overrides: Partial<User> = {}): User {
  return {
    id: 'actor-1',
    subscriptionId: 'sub-1',
    role: RoleType.OWNER,
    isPlatformAdmin: false,
    email: 'owner@example.com',
    username: 'owner',
    displayName: 'Owner',
    avatarUrl: null,
    avatarColor: null,
    authMethod: 'PASSWORD_ONLY' as User['authMethod'],
    identificationType: null,
    identificationNumber: null,
    isActive: true,
    totpEnabled: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    emailVerifiedAt: null,
    lastLoginAt: null,
    lastLoginWorkstationId: null,
    lastPasswordChangeAt: null,
    status: 'ACTIVE' as User['status'],
    mustChangePassword: false,
    createdByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildTargetUser(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'target-1',
    subscriptionId: 'sub-1',
    role: RoleType.CASHIER,
    isPlatformAdmin: false,
    email: 'cashier@example.com',
    username: 'cashier',
    displayName: 'Cashier',
    status: 'PENDING_SETUP',
    ...overrides,
  };
}

describe('UsersController', () => {
  let prisma: MockProxy<PrismaClient>;
  let auditServiceMock: { log: jest.Mock };
  let pinServiceMock: { hash: jest.Mock; generate: jest.Mock };
  let passwordHasherMock: { hash: jest.Mock };
  let controller: UsersController;

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    auditServiceMock = { log: jest.fn().mockResolvedValue(undefined) };
    pinServiceMock = {
      hash: jest.fn().mockResolvedValue('hashed-pin'),
      generate: jest.fn().mockReturnValue('482913'),
    };
    passwordHasherMock = {
      hash: jest
        .fn()
        .mockResolvedValue({ hash: 'hashed-password', algorithm: 'argon2id' }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      // ThrottlerModule supplies the guard's storage/options providers, which
      // the isolated test module otherwise lacks (overrideGuard alone cannot
      // satisfy compile-time DI). Guards never execute under direct
      // controller-method calls, so the generous test limit never trips.
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60000, limit: 1000 }],
        }),
      ],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: PinService, useValue: pinServiceMock },
        { provide: PasswordHasherService, useValue: passwordHasherMock },
        { provide: SessionService, useValue: {} },
        { provide: AuditService, useValue: auditServiceMock },
        { provide: OfflineTokenService, useValue: {} },
        { provide: AuthService, useValue: {} },
      ],
    })
      // listLoginIdentities binds ThrottlerGuard at method level; its real
      // storage/options providers live in AppModule, so unit tests stub the
      // guard the same way other controller specs stub auth guards.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = moduleRef.get(UsersController);
  });

  describe('approveUser', () => {
    it('transitions a PENDING_SETUP account to ACTIVE and returns a confirmation', async () => {
      prisma.user.findUnique.mockResolvedValue(buildTargetUser() as never);
      prisma.user.update.mockResolvedValue({
        id: 'target-1',
        status: 'ACTIVE',
      } as never);

      const result = await controller.approveUser(buildActor(), 'target-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'target-1' },
        data: {
          status: 'ACTIVE',
          isActive: true,
          lockedUntil: null,
          failedLoginAttempts: 0,
        },
      });
      expect(result).toEqual({ message: 'Account approved' });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null as never);

      await expect(
        controller.approveUser(buildActor(), 'missing-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the account is not PENDING_SETUP', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildTargetUser({ status: 'ACTIVE' }) as never,
      );

      await expect(
        controller.approveUser(buildActor(), 'target-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(auditServiceMock.log).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when a MANAGER approves a non-CASHIER', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildTargetUser({ role: RoleType.MANAGER }) as never,
      );

      await expect(
        controller.approveUser(
          buildActor({ role: RoleType.MANAGER }),
          'target-1',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('lets a MANAGER approve a CASHIER', async () => {
      prisma.user.findUnique.mockResolvedValue(buildTargetUser() as never);
      prisma.user.update.mockResolvedValue({
        id: 'target-1',
        status: 'ACTIVE',
      } as never);

      const result = await controller.approveUser(
        buildActor({ role: RoleType.MANAGER }),
        'target-1',
      );

      expect(prisma.user.update).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Account approved' });
    });

    it('writes a USER_APPROVED audit log with the actor context', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildTargetUser({ role: RoleType.CASHIER }) as never,
      );
      prisma.user.update.mockResolvedValue({
        id: 'target-1',
        status: 'ACTIVE',
      } as never);

      await controller.approveUser(
        buildActor({ role: RoleType.MANAGER, id: 'actor-9' }),
        'target-1',
      );

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        AuditEvent.USER_APPROVED,
        {
          actorId: 'actor-9',
          actorRole: RoleType.MANAGER,
          targetType: 'User',
          targetId: 'target-1',
          details: { role: RoleType.CASHIER },
        },
      );
    });
  });

  describe('listUsers', () => {
    function buildUserRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'row-1',
        displayName: 'Row User',
        fullName: 'Row User Full',
        email: 'row@example.com',
        username: 'rowuser',
        role: RoleType.CASHIER,
        status: 'ACTIVE',
        isActive: true,
        avatarUrl: null,
        avatarColor: null,
        authMethod: 'PIN_ONLY',
        pinHash: 'argon2-hash-value',
        passwordHash: null,
        totpEnabled: false,
        emailVerifiedAt: null,
        lastLoginAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        createdById: 'actor-1',
        deletedAt: null,
        ...overrides,
      };
    }

    it('exposes credential presence as booleans and never serializes the hashes (offset path)', async () => {
      prisma.user.findMany.mockResolvedValue([
        buildUserRow(),
        buildUserRow({
          id: 'row-2',
          pinHash: null,
          passwordHash: 'argon2-password-hash',
        }),
        buildUserRow({ id: 'row-3', pinHash: null, passwordHash: null }),
      ] as never);
      prisma.user.count.mockResolvedValue(3 as never);

      const result = await controller.listUsers(buildActor());

      expect(result.users[0]).toMatchObject({
        id: 'row-1',
        hasPin: true,
        hasPassword: false,
      });
      expect(result.users[1]).toMatchObject({
        id: 'row-2',
        hasPin: false,
        hasPassword: true,
      });
      expect(result.users[2]).toMatchObject({
        id: 'row-3',
        hasPin: false,
        hasPassword: false,
      });
      expect(result.total).toBe(3);

      const serialized = JSON.stringify(result.users);
      expect(serialized).not.toContain('argon2-hash-value');
      expect(serialized).not.toContain('argon2-password-hash');
      for (const user of result.users) {
        expect(user).not.toHaveProperty('pinHash');
        expect(user).not.toHaveProperty('passwordHash');
      }
    });

    it('strips credential hashes on keyset continuation pages too', async () => {
      // Real cursor payload — the controller hands it to paginateWithCursor,
      // which fetches full rows (no select) on this path.
      const cursor = Buffer.from(
        JSON.stringify({
          lastUpdatedAt: '2026-01-01T00:00:00.000Z',
          lastId: 'prev-row',
        }),
      ).toString('base64');

      prisma.user.findMany.mockResolvedValue([
        buildUserRow({ id: 'row-cursor' }),
      ] as never);

      const result = await controller.listUsers(buildActor(), undefined, undefined, undefined, undefined, undefined, undefined, cursor);

      expect(result.users[0]).toMatchObject({
        id: 'row-cursor',
        hasPin: true,
        hasPassword: false,
      });

      const serialized = JSON.stringify(result.users);
      expect(serialized).not.toContain('argon2-hash-value');
      expect(result.users[0]).not.toHaveProperty('pinHash');
      expect(result.users[0]).not.toHaveProperty('passwordHash');
    });
  });

  describe('listLoginIdentities', () => {
    function buildIdentityRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'identity-1',
        displayName: 'Cajera Uno',
        fullName: 'Cajera Uno Full',
        username: 'cajera-uno',
        role: RoleType.CASHIER,
        status: 'ACTIVE',
        isActive: true,
        avatarUrl: null,
        avatarColor: null,
        pinHash: 'argon2-pin-hash',
        passwordHash: null,
        ...overrides,
      };
    }

    it('returns an empty grid without hitting Prisma when the requester has no subscription', async () => {
      const result = await controller.listLoginIdentities(
        buildActor({ subscriptionId: null }),
        { limit: 50 },
      );

      expect(result).toEqual({ users: [] });
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('scopes the query to ACTIVE non-deleted users of the requester subscription', async () => {
      prisma.user.findMany.mockResolvedValue([] as never);

      await controller.listLoginIdentities(buildActor(), { limit: 50 });

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          subscriptionId: 'sub-1',
          status: 'ACTIVE',
          isActive: true,
          deletedAt: null,
        },
        select: expect.objectContaining({
          pinHash: true,
          passwordHash: true,
        }),
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        take: 50,
      });
    });

    it('passes a custom limit through as take', async () => {
      prisma.user.findMany.mockResolvedValue([] as never);

      await controller.listLoginIdentities(buildActor(), { limit: 10 });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it('prefers displayName when present', async () => {
      prisma.user.findMany.mockResolvedValue([
        buildIdentityRow({ displayName: 'Mostrador' }),
      ] as never);

      const result = await controller.listLoginIdentities(buildActor(), {
        limit: 50,
      });

      expect(result.users[0]).toMatchObject({ displayName: 'Mostrador' });
    });

    it('falls back to fullName when displayName is null', async () => {
      prisma.user.findMany.mockResolvedValue([
        buildIdentityRow({ displayName: null, fullName: 'Nombre Completo' }),
      ] as never);

      const result = await controller.listLoginIdentities(buildActor(), {
        limit: 50,
      });

      expect(result.users[0]).toMatchObject({
        displayName: 'Nombre Completo',
      });
    });

    it('exposes credential presence as booleans and never serializes the hashes', async () => {
      prisma.user.findMany.mockResolvedValue([
        buildIdentityRow({
          id: 'identity-both',
          pinHash: 'argon2-pin-hash',
          passwordHash: 'argon2-password-hash',
        }),
        buildIdentityRow({
          id: 'identity-pin',
          pinHash: 'argon2-pin-hash',
          passwordHash: null,
        }),
        buildIdentityRow({
          id: 'identity-password',
          pinHash: null,
          passwordHash: 'argon2-password-hash',
        }),
        buildIdentityRow({
          id: 'identity-neither',
          pinHash: null,
          passwordHash: null,
        }),
      ] as never);

      const result = await controller.listLoginIdentities(buildActor(), {
        limit: 50,
      });

      expect(result.users).toMatchObject([
        { id: 'identity-both', hasPin: true, hasPassword: true },
        { id: 'identity-pin', hasPin: true, hasPassword: false },
        { id: 'identity-password', hasPin: false, hasPassword: true },
        { id: 'identity-neither', hasPin: false, hasPassword: false },
      ]);

      const serialized = JSON.stringify(result.users);
      expect(serialized).not.toContain('argon2-pin-hash');
      expect(serialized).not.toContain('argon2-password-hash');
      for (const user of result.users) {
        expect(user).not.toHaveProperty('pinHash');
        expect(user).not.toHaveProperty('passwordHash');
      }
    });

    it('ignores workstationId when querying', async () => {
      prisma.user.findMany.mockResolvedValue([
        buildIdentityRow(),
      ] as never);

      const result = await controller.listLoginIdentities(buildActor(), {
        limit: 50,
        workstationId: 'ws-1',
      });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            subscriptionId: 'sub-1',
            status: 'ACTIVE',
            isActive: true,
            deletedAt: null,
          },
          take: 50,
        }),
      );
      expect(result.users).toHaveLength(1);
      expect(result.users[0]).toMatchObject({ id: 'identity-1' });
    });

    it('restricts the avatar grid to all POS roles', () => {
      expect(
        Reflect.getMetadata(
          ROLES_KEY,
          UsersController.prototype.listLoginIdentities,
        ),
      ).toEqual([
        RoleType.OWNER,
        RoleType.MANAGER,
        RoleType.CASHIER,
        RoleType.INVENTORY_ASSISTANT,
        RoleType.ACCOUNTANT,
        RoleType.ADMIN,
      ]);
    });
  });

  describe('createUser', () => {
    function buildCreateDto(overrides: Record<string, unknown> = {}) {
      return {
        displayName: 'Nuevo Cajero',
        role: 'CASHIER',
        ...overrides,
      };
    }

    beforeEach(() => {
      prisma.user.create.mockResolvedValue({
        id: 'new-1',
        displayName: 'Nuevo Cajero',
        fullName: 'Nuevo Cajero',
        username: 'nuevo-cajero',
        role: RoleType.CASHIER,
      } as never);
    });

    it('auto-generates a PIN for a cashier without one and returns its plaintext once', async () => {
      const result = await controller.createUser(
        buildActor(),
        buildCreateDto() as never,
      );

      expect(pinServiceMock.generate).toHaveBeenCalledTimes(1);
      expect(pinServiceMock.hash).toHaveBeenCalledWith('482913');
      expect(result.initialPin).toBe('482913');

      const createData = (prisma.user.create as jest.Mock).mock.calls[0][0]
        .data;
      expect(createData.pinHash).toBe('hashed-pin');
    });

    it('echoes the supplied initialPin instead of generating one', async () => {
      const result = await controller.createUser(
        buildActor(),
        buildCreateDto({ initialPin: '135790' }) as never,
      );

      expect(pinServiceMock.generate).not.toHaveBeenCalled();
      expect(pinServiceMock.hash).toHaveBeenCalledWith('135790');
      expect(result.initialPin).toBe('135790');
    });

    it('returns no initialPin and persists no PIN hash for a manager without one', async () => {
      prisma.user.create.mockResolvedValue({
        id: 'new-2',
        displayName: 'Nueva Gerente',
        fullName: 'Nueva Gerente',
        username: 'nueva-gerente',
        role: RoleType.MANAGER,
      } as never);

      const result = await controller.createUser(
        buildActor(),
        buildCreateDto({ role: 'MANAGER' }) as never,
      );

      expect(pinServiceMock.generate).not.toHaveBeenCalled();
      expect(result.initialPin).toBeNull();

      const createData = (prisma.user.create as jest.Mock).mock.calls[0][0]
        .data;
      expect(createData.pinHash).toBeNull();
    });
  });
});
