import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleType, User } from '@pharmacy/shared-types';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Role-supersession map: a role (key) implicitly satisfies any check for
 * its listed targets.  This lets `OWNER` pass `ADMIN` requirements and
 * `SAAS_ADMIN` pass everything, without editing every `@Roles()` decorator.
 *
 * Only superseding relationships that are semantically correct go here.
 * Same-level roles (CASHIER / INVENTORY_ASSISTANT) do NOT supersede each
 * other — they have different job functions.
 */
const ROLE_SUPERSEDES: Partial<Record<RoleType, RoleType[]>> = {
  [RoleType.OWNER]: [RoleType.ADMIN, RoleType.MANAGER, RoleType.ACCOUNTANT, RoleType.INVENTORY_ASSISTANT],
  [RoleType.SAAS_ADMIN]: [
    RoleType.OWNER,
    RoleType.ADMIN,
    RoleType.MANAGER,
    RoleType.ACCOUNTANT,
    RoleType.CASHIER,
    RoleType.INVENTORY_ASSISTANT,
  ],
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleType[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: User = request.user;

    if (!user) {
      throw new ForbiddenException('Insufficient permissions for this action');
    }

    const hasRole = requiredRoles.some((required) => {
      // 1. Direct match
      if (required === user.role) return true;
      // 2. Supersession: user's role implicitly satisfies this requirement
      return ROLE_SUPERSEDES[user.role]?.includes(required) ?? false;
    });

    if (!hasRole) {
      throw new ForbiddenException(
        'Insufficient permissions for this action',
      );
    }

    return true;
  }
}
