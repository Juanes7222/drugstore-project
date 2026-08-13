import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT guard that authenticates when a valid token is present but never
 * rejects the request when the token is missing or invalid.
 *
 * Used by POS-sync endpoints that must work both unauthenticated (first
 * boot, expired token) and authenticated (normal operation). When a valid
 * token is present, `request.user` is populated and the global
 * TenantContextInterceptor binds the subscription as `app.current_tenant`,
 * so RLS-scoped reads return the tenant's rows. Without a token the request
 * proceeds and RLS fails closed (empty/defaults) — the historical JWT-free
 * behaviour.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = any>(
    err: any,
    user: any,
    _info: any,
    _context: ExecutionContext,
    _status?: any,
  ): TUser {
    // Never throw: a missing/invalid token degrades to unauthenticated
    // instead of a 401. `request.user` stays null, so no tenant context is
    // injected and RLS fails closed — identical to the JWT-free path.
    if (err || !user) {
      return null as TUser;
    }
    return user;
  }
}
