import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { AuditAction, SystemModule } from '@pharmacy/database';
import type { AuditLog as AuditLogModel } from '@pharmacy/database';
import * as crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Audit event constants
// ---------------------------------------------------------------------------

export const AuditEvent = {
  // Auth events
  LOGIN_SUCCESS: 'AUTH_LOGIN_SUCCESS',
  LOGIN_FAILURE: 'AUTH_LOGIN_FAILURE',
  LOGOUT: 'AUTH_LOGOUT',
  REFRESH_TOKEN: 'AUTH_REFRESH_TOKEN',
  REVOKED_REFRESH_REUSE: 'AUTH_REVOKED_REFRESH_REUSE',

  // 2FA events
  TOTP_SETUP: 'AUTH_TOTP_SETUP',
  TOTP_VERIFIED: 'AUTH_TOTP_VERIFIED',
  TOTP_DISABLED: 'AUTH_TOTP_DISABLED',
  BACKUP_CODE_USED: 'AUTH_BACKUP_CODE_USED',

  // Password/PIN events
  PASSWORD_CHANGED: 'AUTH_PASSWORD_CHANGED',
  PIN_CHANGED: 'AUTH_PIN_CHANGED',
  PIN_RESET: 'AUTH_PIN_RESET',
  PASSWORD_RESET_REQUESTED: 'AUTH_PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'AUTH_PASSWORD_RESET_COMPLETED',

  // User management events
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DISABLED: 'USER_DISABLED',
  USER_ENABLED: 'USER_ENABLED',
  USER_LOCKED: 'USER_LOCKED',
  USER_UNLOCKED: 'USER_UNLOCKED',
  ROLE_CHANGED: 'USER_ROLE_CHANGED',
  USER_SWITCHED: 'USER_SWITCHED',

  // Session events
  SESSION_REVOKED: 'SESSION_REVOKED',
  SESSION_EVICTED: 'SESSION_EVICTED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',

  // Step-up events
  STEP_UP_REQUESTED: 'STEP_UP_REQUESTED',
  STEP_UP_AUTHORIZED: 'STEP_UP_AUTHORIZED',
  STEP_UP_DENIED: 'STEP_UP_DENIED',
  STEP_UP_EXPIRED: 'STEP_UP_EXPIRED',

  // Account lockout
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED: 'ACCOUNT_UNLOCKED',
  LOGIN_ATTEMPT: 'AUTH_LOGIN_ATTEMPT',

  // Account recovery
  FORGOT_PASSWORD: 'AUTH_FORGOT_PASSWORD',
} as const;

export type AuditEventType = (typeof AuditEvent)[keyof typeof AuditEvent];

// ---------------------------------------------------------------------------
// Audit context
// ---------------------------------------------------------------------------

export interface AuditContext {
  actorId: string | null;
  actorRole: string | null;
  targetType?: string;
  targetId?: string;
  workstationId?: string | null;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown> | null;
  correlationId?: string | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Log an audit event.
   * Fire-and-forget: never throws, so a failed write never blocks the operation.
   */
  async log(event: AuditEventType, context: AuditContext): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          action: this.mapEventToAction(event),
          module: SystemModule.AUTH_USERS,
          entityType: context.targetType ?? 'unknown',
          entityId: context.targetId ?? 'unknown',
          userId: context.actorId ?? undefined,
          userRole: context.actorRole ?? undefined,
          workstationId: context.workstationId ?? undefined,
          sessionId: context.sessionId ?? undefined,
          correlationId: context.correlationId ?? undefined,
          ipAddress: context.ipAddress ?? undefined,
          userAgent: context.userAgent ?? undefined,
          details: context.details
            ? JSON.stringify(context.details)
            : undefined,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log for event ${event}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Query audit logs with filters.
   */
  async query(params: {
    event?: AuditEventType;
    actorId?: string;
    targetType?: string;
    targetId?: string;
    workstationId?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ rows: AuditLogModel[]; total: number }> {
    const where: Record<string, unknown> = {};

    if (params.event) {
      where.action = this.mapEventToAction(params.event);
    }
    if (params.actorId) {
      where.userId = params.actorId;
    }
    if (params.targetType) {
      where.entityType = params.targetType;
    }
    if (params.targetId) {
      where.entityId = params.targetId;
    }
    if (params.workstationId) {
      where.workstationId = params.workstationId;
    }
    if (params.fromDate || params.toDate) {
      where.createdAt = {
        ...(params.fromDate ? { gte: params.fromDate } : {}),
        ...(params.toDate ? { lte: params.toDate } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: params.limit ?? 50,
        skip: params.offset ?? 0,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { rows, total };
  }

  /**
   * Map an audit event string to a Prisma AuditAction enum value.
   * This determines the `action` column used for filtering in the audit log UI.
   */
  private mapEventToAction(event: string): AuditAction {
    if (event.includes('CREATE') || event.includes('SETUP')) {
      return AuditAction.CREATE;
    }
    if (
      event.includes('CHANGE') ||
      event.includes('UPDATE') ||
      event.includes('CHANGED') ||
      event.includes('RESET') ||
      event.includes('ENABLE') ||
      event.includes('DISABLE')
    ) {
      return AuditAction.UPDATE;
    }
    if (event.includes('DELETE') || event.includes('REVOKE')) {
      return AuditAction.DELETE;
    }
    if (event.includes('LOGIN')) {
      return event.includes('SUCCESS') ? AuditAction.LOGIN : AuditAction.ACCESS;
    }
    if (event.includes('LOGOUT')) {
      return AuditAction.LOGOUT;
    }
    if (event.includes('LOCKED') || event.includes('UNLOCKED')) {
      return AuditAction.STATE_CHANGE;
    }
    if (event.includes('AUTHORIZED') || event.includes('APPROVE')) {
      return AuditAction.ACCESS;
    }
    if (event.includes('DENIED') || event.includes('FAILURE')) {
      return AuditAction.ACCESS;
    }

    return AuditAction.ACCESS;
  }
}
