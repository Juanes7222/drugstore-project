import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';
import * as crypto from 'crypto';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import type { AuditAction as PrismaAuditAction, SystemModule as PrismaSystemModule } from '@pharmacy/database';
import {
  AUDITABLE_KEY,
  AuditableMetadata,
} from '../decorators/auditable.decorator';
import { AuditAction, SystemModule, User } from '@pharmacy/shared-types';

// The @Auditable decorator vocabulary (shared-types) intentionally differs
// from the persisted AuditLog enums (Prisma) — see enums.spec.ts "different
// scope per side". AuditLog.module/action are PostgreSQL enums, so any
// value outside the Prisma vocabulary is rejected by the database. Every
// decorator value is therefore mapped explicitly below. A shared value
// without a Prisma counterpart (AUDIT module, READ action) has no current
// @Auditable user and skips the write with a warning rather than failing
// at the DB; add a Prisma enum migration first if one ever gets used.
const SYSTEM_MODULE_MAP: Record<SystemModule, PrismaSystemModule | undefined> = {
  [SystemModule.AUTH]: 'AUTH_USERS',
  [SystemModule.CATALOG]: 'CATALOG',
  [SystemModule.INVENTORY]: 'INVENTORY',
  [SystemModule.PURCHASES]: 'PURCHASES',
  [SystemModule.SALES]: 'SALES_POS',
  [SystemModule.CASH_SHIFT]: 'CASH_SHIFT',
  [SystemModule.FISCAL]: 'FISCAL_DIAN',
  [SystemModule.SYNC]: 'SYNC_OFFLINE',
  [SystemModule.CONFIG]: 'CONFIGURATION',
  [SystemModule.AUDIT]: undefined,
  [SystemModule.CLIENTS]: 'CLIENTS',
  [SystemModule.REPORTS]: 'REPORTS',
};

const AUDIT_ACTION_MAP: Record<AuditAction, PrismaAuditAction | undefined> = {
  [AuditAction.CREATE]: 'CREATE',
  [AuditAction.READ]: undefined,
  [AuditAction.UPDATE]: 'UPDATE',
  [AuditAction.DELETE]: 'DELETE',
  [AuditAction.LOGIN]: 'LOGIN',
  [AuditAction.LOGOUT]: 'LOGOUT',
  [AuditAction.EXPORT]: 'EXPORT',
  [AuditAction.IMPORT]: 'IMPORT',
  // Approving a Habeas Data request flips its state (PENDING_* -> RECTIFIED/
  // ERASURED/REJECTED); STATE_CHANGE is the closest persisted semantic.
  [AuditAction.APPROVE]: 'STATE_CHANGE',
  [AuditAction.ACCESS]: 'ACCESS',
  [AuditAction.STATE_CHANGE]: 'STATE_CHANGE',
};

// Extend Express Request to include Passport user
declare module 'http' {
  interface IncomingMessage {
    user?: User;
  }
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);
  private readonly mutatingMethods = ['POST', 'PATCH', 'PUT', 'DELETE'];

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    private tenantContext: TenantContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    if (!this.mutatingMethods.includes(request.method)) {
      return next.handle();
    }

    const metadata = this.reflector.get<AuditableMetadata>(
      AUDITABLE_KEY,
      context.getHandler(),
    );

    if (!metadata) {
      return next.handle();
    }

    const user: User | undefined = request.user as User | undefined;
    const userRole = user?.role || null;
    const userId = user?.id || null;

    return next.handle().pipe(
      tap({
        next: () => {
          this.writeAuditLog(metadata, request, userId, userRole).catch((error) => {
            this.logger.error(
              `Failed to write audit log for ${request.method} ${request.url}`,
              error,
            );
          });
        },
        error: (error) => {
          this.logger.error(`Error in ${request.method} ${request.url}`, error);
        },
      }),
    );
  }

  private async writeAuditLog(
    metadata: AuditableMetadata,
    request: Request,
    userId: string | null,
    userRole: string | null,
  ): Promise<void> {
    try {
      const module = SYSTEM_MODULE_MAP[metadata.module];
      const action = AUDIT_ACTION_MAP[metadata.action];
      if (module === undefined || action === undefined) {
        this.logger.warn(
          `Skipping audit log: ${String(metadata.module)}/${String(metadata.action)} ` +
            'has no persisted Prisma enum counterpart',
        );
        return;
      }

      // Join the request-scoped transaction when one is active so the audit
      // row commits (or rolls back) atomically with the mutation it records.
      // Falls back to the root client outside request context (cron jobs).
      const db = this.tenantContext.getTx() ?? this.prisma;
      await db.auditLog.create({
        data: {
          id: this.generateId(),
          action,
          module,
          entityType: metadata.entityType,
          entityId: this.extractEntityId(request),
          userId,
          userRole,
          workstationId: request.headers['x-workstation-id'] as string | null,
          sessionId: request.headers['x-session-id'] as string | null,
          correlationId: request.headers['x-correlation-id'] as string | null,
          ipAddress: this.extractIpAddress(request),
          userAgent: request.get('user-agent') || null,
        },
      });
    } catch (error) {
      this.logger.error('Failed to create audit log entry', error);
    }
  }

  private generateId(): string {
    return crypto.randomUUID();
  }

  private extractEntityId(request: Request): string {
    const pathSegments = request.path.split('/').filter(Boolean);
    return pathSegments[pathSegments.length - 1] || 'unknown';
  }

  private extractIpAddress(request: Request): string | null {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return request.ip || null;
  }
}
