import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleType } from '@pharmacy/shared-types';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function createMockContext(user?: { role?: string }): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  describe('when no roles are required', () => {
    it('should return true when getAllAndOverride returns undefined', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const ctx = createMockContext({ role: RoleType.CASHIER });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should return true when requiredRoles is an empty array', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
      const ctx = createMockContext({ role: RoleType.CASHIER });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('when roles are required', () => {
    it('should return true when user role matches', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([RoleType.ADMIN]);
      const ctx = createMockContext({ role: RoleType.ADMIN });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should return true when user has one of multiple required roles', () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue([RoleType.ADMIN, RoleType.INVENTORY_ASSISTANT]);
      const ctx = createMockContext({ role: RoleType.INVENTORY_ASSISTANT });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should throw ForbiddenException when user role does not match', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([RoleType.ADMIN]);
      const ctx = createMockContext({ role: RoleType.CASHIER });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when user role does not match any of multiple roles', () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue([RoleType.ADMIN, RoleType.INVENTORY_ASSISTANT]);
      const ctx = createMockContext({ role: RoleType.ACCOUNTANT });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });

  describe('when user is missing from request', () => {
    it('should throw ForbiddenException when user is undefined', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([RoleType.ADMIN]);
      const ctx = createMockContext(undefined);
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when user has no role property', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([RoleType.ADMIN]);
      const ctx = createMockContext({});
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });

  describe('metadata resolution', () => {
    it('should call getAllAndOverride with ROLES_KEY', () => {
      const spy = jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([RoleType.ADMIN]);
      const ctx = createMockContext({ role: RoleType.ADMIN });

      guard.canActivate(ctx);

      expect(spy).toHaveBeenCalledWith(ROLES_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
    });
  });
});
