import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DomainException } from '@/common/exceptions/domain.exception';
import { LicenseTokenService } from '../tokens/license-token.service';
import { FraudDetectionService } from '../fraud/fraud-detection.service';
import type { CheckInDto } from './dto/check-in.dto';

@Injectable()
export class CheckInsService {
  private readonly logger = new Logger(CheckInsService.name);

  // Deduplication window in milliseconds (5 minutes)
  private readonly DEDUP_WINDOW_MS = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly licenseTokenService: LicenseTokenService,
    private readonly fraudDetectionService: FraudDetectionService,
  ) {}

  /**
   * Process a workstation check-in.
   *
   * The check-in is idempotent within a 5-minute window — duplicate requests
   * return the same response without creating duplicate records.
   */
  async checkIn(dto: CheckInDto, requestIp?: string) {
    // 1. Verify the token is valid
    let tokenClaims: Record<string, unknown>;
    try {
      tokenClaims = this.licenseTokenService.verifyToken(dto.activationToken);
    } catch {
      throw new DomainException('INVALID_LICENSE_TOKEN', 'The license token is invalid or expired', HttpStatus.UNAUTHORIZED);
    }

    const subscriptionId = tokenClaims.subscriptionId as string;
    const workstationId = tokenClaims.workstationId as string;

    // 2. Find the activation and validate hardware fingerprint matches
    const activation = await this.prisma.workstationActivation.findUnique({
      where: { id: workstationId },
      include: {
        subscription: { include: { plan: true } },
        location: true,
      },
    });

    if (!activation) {
      throw new DomainException('ACTIVATION_NOT_FOUND', 'Workstation activation not found', HttpStatus.NOT_FOUND);
    }

    if (!activation.isActive) {
      throw new DomainException('ACTIVATION_REVOKED', 'This activation has been revoked', HttpStatus.FORBIDDEN);
    }

    if (activation.hardwareFingerprint !== dto.hardwareFingerprint) {
      // Token replay from different fingerprint — HIGH severity fraud
      await this.fraudDetectionService.reportTokenReplay({
        activationId: activation.id,
        subscriptionId: activation.subscriptionId,
        expectedFingerprint: activation.hardwareFingerprint,
        receivedFingerprint: dto.hardwareFingerprint,
        requestIp: requestIp ?? 'unknown',
      });
      throw new DomainException(
        'FINGERPRINT_MISMATCH',
        'Hardware fingerprint does not match the activation record. Contact your provider.',
        HttpStatus.FORBIDDEN,
      );
    }

    const subscription = activation.subscription;
    const location = activation.location;

    // 3. Check subscription status
    const isActiveOrTrial = ['ACTIVE', 'TRIAL'].includes(subscription.status);
    const isPastDue = subscription.status === 'PAST_DUE';
    const isBeyondGrace = this.isBeyondGracePeriod(subscription);

    let licenseStatus: string;
    let tokenExpiresAt: Date;

    if (isActiveOrTrial) {
      licenseStatus = 'ACTIVE';
      // Issue a standard 7-day token
      const tokenResult = this.licenseTokenService.generateToken({
        subscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        planId: subscription.plan.id,
        planFeatures: subscription.plan.features,
        locationId: activation.locationId,
        locationName: location?.name ?? '',
        workstationId: activation.id,
        hardwareFingerprint: activation.hardwareFingerprint,
      });
      tokenExpiresAt = new Date(tokenResult.expiresAt);
    } else if (isPastDue && !isBeyondGrace) {
      licenseStatus = 'GRACE_PERIOD';
      // Issue a short-lived token (extend by grace period remaining)
      const graceEndDate = new Date(subscription.currentPeriodEnd);
      graceEndDate.setDate(graceEndDate.getDate() + subscription.gracePeriodDays);
      const tokenResult = this.licenseTokenService.generateToken({
        subscriptionId: subscription.id,
        subscriptionStatus: 'GRACE_PERIOD',
        planId: subscription.plan.id,
        planFeatures: subscription.plan.features,
        locationId: activation.locationId,
        locationName: location?.name ?? '',
        workstationId: activation.id,
        hardwareFingerprint: activation.hardwareFingerprint,
        expiresAt: graceEndDate,
      });
      tokenExpiresAt = new Date(tokenResult.expiresAt);
    } else {
      licenseStatus = 'LOCKED';
      tokenExpiresAt = new Date();
    }

    // 4. Run fraud detection
    await this.fraudDetectionService.runCheckInChecks({
      activationId: activation.id,
      subscriptionId: subscription.id,
      hardwareFingerprint: dto.hardwareFingerprint,
      requestIp: requestIp ?? 'unknown',
      workstation: activation,
    });

    // 5. Record check-in (with dedup)
    const now = new Date();

    // Check if a check-in was already recorded within the dedup window
    const recentCheckIn = await this.prisma.licenseCheckIn.findFirst({
      where: {
        workstationActivationId: activation.id,
        checkedInAt: { gte: new Date(now.getTime() - this.DEDUP_WINDOW_MS) },
      },
      orderBy: { checkedInAt: 'desc' },
    });

    if (!recentCheckIn) {
      await this.prisma.licenseCheckIn.create({
        data: {
          id: crypto.randomUUID(),
          workstationActivationId: activation.id,
          subscriptionId: subscription.id,
          ipAddress: requestIp ?? null,
          hardwareFingerprint: dto.hardwareFingerprint,
          tokenExpiresAt,
          checkedInAt: now,
        },
      });

      // Update activation's last check-in info
      await this.prisma.workstationActivation.update({
        where: { id: activation.id },
        data: {
          lastCheckInAt: now,
          lastCheckInIp: requestIp ?? null,
          checkInCount: { increment: 1 },
        },
      });
    }

    // 6. Compute grace period info
    const daysUntilGracePeriodEnd = isPastDue && !isBeyondGrace
      ? Math.ceil((tokenExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return {
      activationToken: isActiveOrTrial || (isPastDue && !isBeyondGrace)
        ? this.licenseTokenService.generateToken({
            subscriptionId: subscription.id,
            subscriptionStatus: licenseStatus,
            planId: subscription.plan.id,
            planFeatures: subscription.plan.features,
            locationId: activation.locationId,
            locationName: location?.name ?? '',
            workstationId: activation.id,
            hardwareFingerprint: activation.hardwareFingerprint,
            expiresAt: tokenExpiresAt,
          }).token
        : null,
      expiresAt: tokenExpiresAt.toISOString(),
      licenseStatus,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        gracePeriodDays: subscription.gracePeriodDays,
      },
      daysUntilGracePeriodEnd,
    };
  }

  async getCheckInHistory(activationId: string, limit = 10) {
    return this.prisma.licenseCheckIn.findMany({
      where: { workstationActivationId: activationId },
      orderBy: { checkedInAt: 'desc' },
      take: limit,
    });
  }

  async getCheckInCountSince(activationId: string, since: Date): Promise<number> {
    return this.prisma.licenseCheckIn.count({
      where: {
        workstationActivationId: activationId,
        checkedInAt: { gte: since },
      },
    });
  }

  private isBeyondGracePeriod(subscription: { status: string; currentPeriodEnd: Date; gracePeriodDays: number }): boolean {
    if (subscription.status !== 'PAST_DUE') return false;
    const graceEnd = new Date(subscription.currentPeriodEnd);
    graceEnd.setDate(graceEnd.getDate() + subscription.gracePeriodDays);
    return new Date() > graceEnd;
  }
}
