// Binds the authenticated user's tenantId into the tenant context and
// runs the whole request handler inside one RLS-scoped transaction: a single
// SET LOCAL so every read and write on the request observes the tenant.
// Endpoints without a tenant (login, health, licensing) run without it.
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { defer, lastValueFrom, Observable } from 'rxjs';
import { TenantContextService } from './tenant-context.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

interface RequestWithUser {
  user?: { subscriptionId?: string };
}

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const subscriptionId = request.user?.subscriptionId;
    if (!subscriptionId) {
      return next.handle();
    }

    return defer(() =>
      this.prisma.withTenant(subscriptionId, () => lastValueFrom(next.handle())),
    );
  }
}