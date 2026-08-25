/**
 * SaaS-admin access audit — records every cross-tenant read a platform
 * admin performs against a specific customer subscription. GET endpoints
 * are not covered by the mutating-only AuditLogInterceptor, so this
 * service writes rows directly, mirroring auth's AuditService contract:
 * fire-and-forget, never blocking or failing the request.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import * as crypto from 'node:crypto';

// The persisted SystemModule enum has no dedicated platform-admin slug;
// REPORTS is the established bucket for read-only reporting surfaces.
// The Subscription entityType/entityId carry the precise target.
const ACCESS_MODULE = 'REPORTS' as const;
const ACCESS_ACTION = 'ACCESS' as const;
const ENTITY_TYPE = 'Subscription';

@Injectable()
export class SaasAdminAccessAuditService {
  private readonly logger = new Logger(SaasAdminAccessAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a platform admin's access to one customer's data. Best-effort.
   */
  async recordCustomerAccess(params: {
    actorUser: { id: string; role: string };
    subscriptionId: string;
    endpoint: string;
    ipAddress?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          action: ACCESS_ACTION,
          module: ACCESS_MODULE,
          entityType: ENTITY_TYPE,
          entityId: params.subscriptionId,
          userId: params.actorUser.id,
          userRole: params.actorUser.role,
          subscriptionId: params.subscriptionId,
          ipAddress: params.ipAddress ?? null,
          details: JSON.stringify({ endpoint: params.endpoint }),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to audit saas-admin access to subscription ${params.subscriptionId}`,
        error,
      );
    }
  }
}
