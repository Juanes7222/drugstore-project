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
  let controller: UsersController;

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    auditServiceMock = { log: jest.fn().mockResolvedValue(undefined) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: PinService, useValue: {} },
        { provide: PasswordHasherService, useValue: {} },
        { provide: SessionService, useValue: {} },
        { provide: AuditService, useValue: auditServiceMock },
        { provide: OfflineTokenService, useValue: {} },
        { provide: AuthService, useValue: {} },
      ],
    }).compile();

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
});
