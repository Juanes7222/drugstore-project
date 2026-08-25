import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { AuditService, AuditEvent } from './audit.service';

describe('AuditEvent constants', () => {
  let prisma: MockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it('exposes USER_APPROVED with the value used by the users controller', () => {
    const service = new AuditService(prisma as never);

    expect(AuditEvent.USER_APPROVED).toBe('USER_APPROVED');
    expect(service).toBeDefined();
  });

  it('exposes the other user-management event constants', () => {
    expect(AuditEvent.USER_CREATED).toBe('USER_CREATED');
    expect(AuditEvent.USER_UPDATED).toBe('USER_UPDATED');
    expect(AuditEvent.USER_DELETED).toBe('USER_DELETED');
    expect(AuditEvent.USER_DISABLED).toBe('USER_DISABLED');
    expect(AuditEvent.USER_ENABLED).toBe('USER_ENABLED');
  });
});