/**
 * SaaS platform-admin guard — the only entry point to /saas-admin/*.
 *
 * Requires BOTH conditions: the SAAS_ADMIN role AND the isPlatformAdmin
 * database flag (granted exclusively via packages/database's
 * set-platform-admin script). The role alone is not sufficient: role
 * assignment happens at bootstrap/provisioning, while the flag marks
 * vetted operators of the platform.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { RoleType, User } from '@pharmacy/shared-types';

const PLATFORM_ACCESS_DENIED_MESSAGE =
  'Platform admin access requires the SAAS_ADMIN role and the platform admin flag';

@Injectable()
export class SaasAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: User | undefined = request.user;

    // Deny by default: an unauthenticated request never reaches this guard
    // when composed after JwtAuthGuard, but stay defensive anyway.
    if (!user) {
      throw new ForbiddenException(PLATFORM_ACCESS_DENIED_MESSAGE);
    }

    if (user.role !== RoleType.SAAS_ADMIN || !user.isPlatformAdmin) {
      throw new ForbiddenException(PLATFORM_ACCESS_DENIED_MESSAGE);
    }

    return true;
  }
}
