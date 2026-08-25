/**
 * Backoffice scope helper — derives tenant-scoped Prisma filters from the
 * caller's identity. Every caller is restricted to its own subscription;
 * platform-level (cross-tenant) reads live exclusively in the saas-admin
 * module, which takes an explicit subscription id per request.
 */

import { Injectable, ForbiddenException } from '@nestjs/common';
import { User } from '@pharmacy/shared-types';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

@Injectable()
export class BackofficeScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Filter for models that carry a `subscriptionId` column directly.
   */
  tenantWhere(user: User): Record<string, unknown> {
    return { subscriptionId: this.requireSubscription(user) };
  }

  /**
   * Filter for Sale, which has no subscriptionId in the shared schema —
   * the tenant is reached through its CashShift.
   */
  saleTenantWhere(user: User): Record<string, unknown> {
    return { cashShift: { subscriptionId: this.requireSubscription(user) } };
  }

  /**
   * Ids of every user in the caller's tenant.
   */
  async tenantUserIds(user: User): Promise<string[]> {
    const subscriptionId = this.requireSubscription(user);
    const users = await this.prisma.user.findMany({
      where: { subscriptionId },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /**
   * Filter for models whose tenant is only reachable through a user
   * (e.g. UserSession via userId).
   */
  async userTenantWhere(user: User): Promise<Record<string, unknown>> {
    const userIds = await this.tenantUserIds(user);
    return { userId: { in: userIds } };
  }

  private requireSubscription(user: User): string {
    if (!user.subscriptionId) {
      // Platform admins are not attached to a subscription, so they cannot
      // use tenant endpoints; their surface is /saas-admin/* instead.
      throw new ForbiddenException('Account is not attached to a subscription');
    }
    return user.subscriptionId;
  }
}
