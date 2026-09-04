/**
 * Dual-path authentication guard for sync endpoints.
 *
 * Accepts either:
 * 1. A standard Bearer JWT (access token) — validated via Passport's `'jwt'`
 *    strategy, which additionally checks the session is still active in the DB.
 * 2. An `X-Offline-Token` header carrying a long-lived offline JWT (14–30 day
 *    TTL) — validated directly via `OfflineTokenService`, which checks the
 *    signature, token type, expiration, and revocation list.
 *
 * The JWT path is attempted first; if it throws (expired, malformed, revoked
 * session) the offline-token fallback kicks in.  This prevents the intermittent
 * 401 errors on `/sync/batch` when the POS workstation's 15-minute access token
 * expires during an offline window and the offline-token exchange
 * (`POST /auth/token/exchange`) transiently fails.
 *
 * When the offline-token path succeeds, `request.user` is populated with the
 * same `User` DTO shape that the JWT strategy produces, so downstream pipes
 * (`@CurrentUser()`, `RolesGuard`, `@Auditable()`) work identically.
 */
import { ExecutionContext, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from '@/modules/auth/auth.service';
import { OfflineTokenService } from '@/modules/auth/offline/offline-token.service';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';

@Injectable()
export class SyncAuthGuard extends AuthGuard('jwt') {
  constructor(
    @Optional() private readonly offlineTokenService: OfflineTokenService,
    @Optional() private readonly authService: AuthService,
    @Optional() private readonly reflector?: Reflector,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector?.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Public routes: try to populate request.user from Bearer or offline token,
    // but never throw — unauthenticated fallback is allowed (bootstrap / RLS fails closed).
    if (isPublic) {
      const request = context.switchToHttp().getRequest();
      try {
        const result = (await super.canActivate(context)) as boolean;
        if (result) return true;
      } catch {
        // fall through to offline attempt
      }
      const offlineToken = this.extractOfflineToken(request);
      if (offlineToken && this.offlineTokenService && this.authService) {
        try {
          const claims = this.offlineTokenService.verifyToken(offlineToken);
          if (claims) {
            const isRevoked = await this.offlineTokenService.isRevoked(claims.jti);
            if (!isRevoked) {
              const user = await this.authService.getActiveUser(claims.sub);
              request.user = user;
              return true;
            }
          }
        } catch {
          // ignore and fall through to unauthenticated allow
        }
      }
      return true;
    }

    const request = context.switchToHttp().getRequest();

    // ---------------------------------------------------------------
    // Path 1: Standard Bearer JWT (access token)
    // ---------------------------------------------------------------
    // Hand off to the parent `AuthGuard('jwt')`, which runs the Passport
    // JWT strategy.  On success the strategy's `validate()` callback sets
    // `request.user` via the passport middleware and this method returns
    // `true`.  On failure (expired token, revoked session, malformed JWT)
    // the parent throws — we catch and fall through.
    try {
      return (await super.canActivate(context)) as boolean;
    } catch {
      // JWT auth failed — fall through to offline token below.
      // Intentionally swallowing: the offline-token path may still
      // succeed, and we throw a single UnauthorizedException only if
      // both paths fail.
    }

    // ---------------------------------------------------------------
    // Path 2: Offline token (X-Offline-Token header)
    // ---------------------------------------------------------------
    const offlineToken = this.extractOfflineToken(request);
    if (!offlineToken) {
      throw new UnauthorizedException('No valid authentication credentials');
    }

    if (!this.offlineTokenService || !this.authService) {
      throw new UnauthorizedException('No valid authentication credentials');
    }

    // 1. Verify the offline token signature, type, and expiration
    const claims = this.offlineTokenService.verifyToken(offlineToken);
    if (!claims) {
      throw new UnauthorizedException('Invalid or expired offline token');
    }

    // 2. Check the revocation list
    const isRevoked = await this.offlineTokenService.isRevoked(claims.jti);
    if (isRevoked) {
      throw new UnauthorizedException('Offline token has been revoked');
    }

    // 3. Look up the user and verify they are still active
    const user = await this.authService.getActiveUser(claims.sub);

    // 4. Populate request.user so downstream decorators (CurrentUser,
    //    RolesGuard, Auditable) work identically to the JWT path
    request.user = user;

    return true;
  }

  /**
   * Extract an offline token from the `X-Offline-Token` request header.
   * Returns `null` when the header is absent or empty.
   */
  private extractOfflineToken(request: any): string | null {
    const header = request.headers['x-offline-token'];
    return typeof header === 'string' && header.length > 0 ? header : null;
  }
}
