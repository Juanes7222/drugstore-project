/**
 * Backoffice scope helper — derives tenant-scoped Prisma filters from the
 * caller's role. SAAS_ADMIN sees every subscription; any other role is
 * restricted to its own subscription.
 */

import { Injectable, ForbiddenException } from '@nestjs/common';
import { RoleType, User } from '@pharmacy/shared-types';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

@Injectable()
export class BackofficeScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Filter for models that carry a `subscriptionId` column directly.
   * Returns an empty object for SAAS_ADMIN (no filter).
   */
  tenantWhere(user: User): Record<string, unknown> {
    if (user.role === RoleType.SAAS_ADMIN) {
      return {};
    }
    return { subscriptionId: this.requireSubscription(user) };
  }

  /**
   * Filter for Sale, which has no subscriptionId — the tenant is reached
   * through its CashShift.
   */
  saleTenantWhere(user: User): Record<string, unknown> {
    if (user.role === RoleType.SAAS_ADMIN) {
      return {};
    }
    return { cashShift: { subscriptionId: this.requireSubscription(user) } };
  }

  /**
   * Ids of every user in the caller's tenant. Returns null for SAAS_ADMIN,
   * meaning "no user filter".
   */
  async tenantUserIds(user: User): Promise<string[] | null> {
    if (user.role === RoleType.SAAS_ADMIN) {
      return null;
    }
    const subscriptionId = this.requireSubscription(user);
    const users = await this.prisma.user.findMany({
      where: { subscriptionId },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /**
   * Filter for models whose tenant is only reachable through a user
   * (e.g. UserSession via userId). Empty object for SAAS_ADMIN.
   */
  async userTenantWhere(user: User): Promise<Record<string, unknown>> {
    const userIds = await this.tenantUserIds(user);
    return userIds === null ? {} : { userId: { in: userIds } };
  }

  private requireSubscription(user: User): string {
    if (!user.subscriptionId) {
      throw new ForbiddenException('Account is not attached to a subscription');
    }
    return user.subscriptionId;
  }
}
