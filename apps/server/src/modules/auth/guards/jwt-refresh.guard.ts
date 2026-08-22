/**
 * Guard for POST /auth/refresh — authenticates with the jwt-refresh
 * strategy, which accepts expired access tokens while the backing
 * session is still active. The handler performs the actual token
 * rotation; this guard only proves possession of a signed token for a
 * live session.
 */

import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {}
