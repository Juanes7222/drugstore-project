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
import { AUDITABLE_KEY, AuditableMetadata } from '../decorators/auditable.decorator';
import { User } from '@pharmacy/shared-types';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);
  private readonly mutatingMethods = ['POST', 'PATCH', 'PUT', 'DELETE'];

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
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
      tap(
        () => {
          this.writeAuditLog(metadata, request, userId, userRole).catch(
            (error) => {
              this.logger.error(
                `Failed to write audit log for ${request.method} ${request.url}`,
                error,
              );
            },
          );
        },
        (error) => {
          this.logger.error(
            `Error in ${request.method} ${request.url}`,
            error,
          );
        },
      ),
    );
  }

  private async writeAuditLog(
    metadata: AuditableMetadata,
    request: Request,
    userId: string | null,
    userRole: string | null,
  ): Promise<void> {
    try {
      await (this.prisma.auditLog as any).create({
        data: {
          id: this.generateId(),
          action: metadata.action,
          module: metadata.module,
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
