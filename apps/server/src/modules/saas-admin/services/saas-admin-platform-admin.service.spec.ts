import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { SaasAdminPlatformAdminService } from './saas-admin-platform-admin.service';

describe('SaasAdminPlatformAdminService', () => {
  let prisma: MockProxy<PrismaClient>;
  let service: SaasAdminPlatformAdminService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new SaasAdminPlatformAdminService(prisma as never);
  });

  it('lists only users with the platform-admin flag, sorted by email asc', async () => {
    prisma.user.findMany.mockResolvedValue([] as never);

    await service.getPlatformAdmins();

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { isPlatformAdmin: true },
      orderBy: { email: 'asc' },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  });

  it('maps rows to the API shape with ISO timestamps', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'u-1',
        email: 'admin@platform.com',
        username: 'admin',
        fullName: 'Platform Admin',
        role: 'SAAS_ADMIN',
        status: 'ACTIVE',
        lastLoginAt: new Date('2026-08-20T09:15:00.000Z'),
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
      },
    ] as never);

    const rows = await service.getPlatformAdmins();

    expect(rows).toEqual([
      {
        userId: 'u-1',
        email: 'admin@platform.com',
        username: 'admin',
        fullName: 'Platform Admin',
        role: 'SAAS_ADMIN',
        status: 'ACTIVE',
        lastLoginAt: '2026-08-20T09:15:00.000Z',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('keeps nullable fields null instead of empty strings', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'u-2',
        email: null,
        username: null,
        fullName: 'Bootstrap Operator',
        role: 'SAAS_ADMIN',
        status: 'PENDING_SETUP',
        lastLoginAt: null,
        createdAt: new Date('2025-02-02T12:00:00.000Z'),
      },
    ] as never);

    const rows = await service.getPlatformAdmins();

    expect(rows[0]).toMatchObject({
      userId: 'u-2',
      email: null,
      username: null,
      lastLoginAt: null,
    });
  });

  it('returns an empty array when no user carries the flag', async () => {
    prisma.user.findMany.mockResolvedValue([] as never);

    expect(await service.getPlatformAdmins()).toEqual([]);
  });
});
