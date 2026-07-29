import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';

/**
 * JWT authentication guard.
 *
 * Skips token validation for routes decorated with `@Public()` (resolved from
 * both the handler and the class, mirroring how `@Roles()` is resolved by
 * `RolesGuard`). This is the only supported way to mark a route as unauthenticated
 * — do not remove the JwtAuthGuard from a controller just to make it public.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}
