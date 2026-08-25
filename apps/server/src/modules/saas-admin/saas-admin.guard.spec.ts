import { describe, it, expect } from '@jest/globals';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RoleType, type User } from '@pharmacy/shared-types';

import { SaasAdminGuard } from './saas-admin.guard';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    subscriptionId: null,
    role: RoleType.SAAS_ADMIN,
    isPlatformAdmin: false,
    email: 'platform@example.com',
    username: 'platform',
    displayName: 'Platform Admin',
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

function buildContext(user: User | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('SaasAdminGuard', () => {
  const guard = new SaasAdminGuard();

  it('allows a SAAS_ADMIN carrying the platform admin flag', () => {
    const context = buildContext(buildUser({ isPlatformAdmin: true }));

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a SAAS_ADMIN without the platform admin flag', () => {
    const context = buildContext(buildUser({ isPlatformAdmin: false }));

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects an undefined flag the same way as false', () => {
    const user = buildUser();
    (user as unknown as Record<string, unknown>).isPlatformAdmin = undefined;
    const context = buildContext(user);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects any other role even when it carries the flag', () => {
    const context = buildContext(
      buildUser({ role: RoleType.OWNER, isPlatformAdmin: true }),
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects an unauthenticated request defensively', () => {
    const context = buildContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
