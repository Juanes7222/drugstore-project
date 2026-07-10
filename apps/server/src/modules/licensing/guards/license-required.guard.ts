import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { LicenseTokenService } from '../tokens/license-token.service';

/**
 * Guard that checks whether the request comes from a workstation with a valid license.
 *
 * Expects the request to have:
 * - Header `X-License-Token`: the signed license token
 * - Header `X-Hardware-Fingerprint`: the workstation's hardware fingerprint
 *
 * This guard is used on the sync batch endpoint and other write-intensive
 * endpoints that process offline operations.
 */
@Injectable()
export class LicenseRequiredGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly licenseTokenService: LicenseTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-license-token'] as string | undefined;
    const fingerprint = request.headers['x-hardware-fingerprint'] as string | undefined;

    if (!token) {
      throw new ForbiddenException('Missing license token');
    }

    if (!fingerprint) {
      throw new ForbiddenException('Missing hardware fingerprint');
    }

    // Verify the token
    let claims: Record<string, unknown>;
    try {
      claims = this.licenseTokenService.verifyToken(token);
    } catch {
      throw new ForbiddenException('Invalid or expired license token');
    }

    // Validate fingerprint matches
    if (claims.hardwareFingerprint !== fingerprint) {
      throw new ForbiddenException('Hardware fingerprint mismatch');
    }

    // Check the subscription status from the database
    const subscriptionId = claims.subscriptionId as string;
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { status: true },
    });

    if (!subscription) {
      throw new ForbiddenException('Subscription not found');
    }

    // Check if subscription is in a valid state
    const invalidStates = ['EXPIRED', 'CANCELLED', 'SUSPENDED'] as const;
    if (invalidStates.includes(subscription.status as typeof invalidStates[number])) {
      throw new ForbiddenException(`License is ${subscription.status.toLowerCase()}`);
    }

    // Attach claims to request for downstream use
    request.licenseClaims = claims;
    request.licenseStatus = subscription.status;

    // Set warning header if PAST_DUE
    if (subscription.status === 'PAST_DUE') {
      request.licenseWarning = 'PAST_DUE';
    }

    return true;
  }
}
