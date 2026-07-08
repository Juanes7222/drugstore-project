import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Mark a route handler as public (no JWT authentication required).
 *
 * Apply to a controller method to bypass the global `JwtAuthGuard`.
 * The corresponding guard must check for this metadata.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);