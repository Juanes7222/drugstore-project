import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleType } from '@pharmacy/shared-types';

/**
 * Permission guard that checks if the user's role has a specific permission.
 *
 * The role hierachy is: SAAS_ADMIN > OWNER > MANAGER > CASHIER
 * Each tier has strictly more permissions than the one below.
 *
 * Usage: @UseGuards(JwtAuthGuard, PermissionGuard)
 *        @Permission(RoleType.MANAGER)
 */
export const PERMISSION_KEY = 'permission';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRole = this.reflector.getAllAndOverride<RoleType>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRole) {
      return true; // No specific permission required
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const userRole = user.role as RoleType;
    const userLevel = this.getRoleLevel(userRole);
    const requiredLevel = this.getRoleLevel(requiredRole);

    if (userLevel < requiredLevel) {
      throw new ForbiddenException(
        `This operation requires at least ${requiredRole} role`,
      );
    }

    return true;
  }

  private getRoleLevel(role: RoleType): number {
    const hierarchy: Record<string, number> = {
      CASHIER: 0,
      INVENTORY_ASSISTANT: 0,
      MANAGER: 1,
      ACCOUNTANT: 1,
      OWNER: 2,
      ADMIN: 2,
      SAAS_ADMIN: 3,
    };
    return hierarchy[role] ?? -1;
  }
}

export const Permission = (role: RoleType) => SetMetadata(PERMISSION_KEY, role);
