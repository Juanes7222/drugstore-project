import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DomainException } from '@/common/exceptions/domain.exception';
import { LicenseTokenService } from '../tokens/license-token.service';
import { FraudDetectionService } from '../fraud/fraud-detection.service';
import type { ActivateDto, GenerateActivationCodeDto } from './dto/activation.dto';

@Injectable()
export class ActivationsService {
  private readonly logger = new Logger(ActivationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly licenseTokenService: LicenseTokenService,
    private readonly fraudDetectionService: FraudDetectionService,
  ) {}

  /**
   * Generate an activation code for a subscription.
   * The initial code for a new subscription is generated automatically by SubscriptionsService.
   * This endpoint is for generating additional codes (e.g., for more workstations).
   */
  async generateActivationCode(subscriptionId: string, dto: GenerateActivationCodeDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });
    if (!subscription) {
      throw new DomainException('SUBSCRIPTION_NOT_FOUND', 'Subscription not found', HttpStatus.NOT_FOUND);
    }
    if (!['ACTIVE', 'TRIAL'].includes(subscription.status)) {
      throw new DomainException('SUBSCRIPTION_NOT_ACTIVE', 'Subscription is not active', HttpStatus.FORBIDDEN);
    }

    // If WORKSTATION type, validate workstation limit for the location
    if (dto.type === 'WORKSTATION' && dto.locationId) {
      const location = await this.prisma.location.findUnique({
        where: { id: dto.locationId },
        include: {
          workstationActivations: { where: { isActive: true } },
        },
      });
      if (!location) {
        throw new DomainException('LOCATION_NOT_FOUND', 'Location not found', HttpStatus.NOT_FOUND);
      }
      if (location.subscriptionId !== subscriptionId) {
        throw new DomainException('LOCATION_MISMATCH', 'Location does not belong to this subscription', HttpStatus.FORBIDDEN);
      }

      const activeWorkstations = location.workstationActivations?.length ?? 0;
      if (activeWorkstations >= subscription.plan.maxWorkstationsPerLocation) {
        throw new DomainException(
          'WORKSTATION_LIMIT_EXCEEDED',
          `Plan ${subscription.plan.code} allows max ${subscription.plan.maxWorkstationsPerLocation} workstation(s) per location. ` +
          `Location ${location.name} already has ${activeWorkstations}.`,
          HttpStatus.FORBIDDEN,
        );
      }
    }

    const code = this.generateCode();
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    return this.prisma.activationCode.create({
      data: {
        id: crypto.randomUUID(),
        subscriptionId,
        locationId: dto.locationId ?? null,
        code,
        type: dto.type ?? 'WORKSTATION',
        status: 'UNUSED',
        expiresAt,
      },
    });
  }

  /**
   * Activate a workstation with an activation code.
   * This is the main activation flow called by the POS desktop.
   */
  async activate(dto: ActivateDto, requestIp?: string) {
    // 1. Find the activation code
    const activationCode = await this.prisma.activationCode.findUnique({
      where: { code: dto.code.trim().toUpperCase() },
      include: { subscription: { include: { plan: true } } },
    });

    if (!activationCode) {
      throw new DomainException('INVALID_ACTIVATION_CODE', 'The activation code is invalid', HttpStatus.NOT_FOUND);
    }

    if (activationCode.status !== 'UNUSED') {
      throw new DomainException(
        'ACTIVATION_CODE_USED',
        `The activation code was already ${activationCode.status.toLowerCase()}`,
        HttpStatus.CONFLICT,
      );
    }

    if (new Date() > activationCode.expiresAt) {
      throw new DomainException('ACTIVATION_CODE_EXPIRED', 'The activation code has expired', HttpStatus.GONE);
    }

    // 2. Validate subscription status
    const subscription = activationCode.subscription;
    if (!['ACTIVE', 'TRIAL'].includes(subscription.status)) {
      throw new DomainException(
        'SUBSCRIPTION_NOT_ACTIVE',
        `Subscription is ${subscription.status.toLowerCase()}. Cannot activate.`,
        HttpStatus.FORBIDDEN,
      );
    }

    // 3. Run fraud detection
    const fraudResult = await this.fraudDetectionService.runActivationChecks({
      code: dto.code,
      hardwareFingerprint: dto.hardwareFingerprint,
      requestIp: requestIp ?? 'unknown',
      subscriptionId: subscription.id,
      subscription,
    });

    if (fraudResult.shouldReject) {
      throw new DomainException(
        'ACTIVATION_REJECTED_FRAUD',
        `Activation rejected: ${fraudResult.reason}`,
        HttpStatus.FORBIDDEN,
      );
    }

    // 4. Handle SUBSCRIPTION type — create the first location
    let locationId = activationCode.locationId;

    if (activationCode.type === 'SUBSCRIPTION') {
      // Create the first location from the activation data
      if (!dto.locationName) {
        throw new DomainException(
          'LOCATION_NAME_REQUIRED',
          'Location name is required for initial activation',
          HttpStatus.BAD_REQUEST,
        );
      }

      const location = await this.prisma.location.create({
        data: {
          id: crypto.randomUUID(),
          subscriptionId: subscription.id,
          name: dto.locationName,
          address: dto.locationAddress ?? null,
          city: dto.locationCity ?? null,
          region: dto.locationRegion ?? null,
          country: 'CO',
          isActive: true,
        },
      });
      locationId = location.id;
    }

    // 5. Validate workstation limit for the location
    if (locationId) {
      const location = await this.prisma.location.findUnique({
        where: { id: locationId },
        include: { workstationActivations: { where: { isActive: true } } },
      });
      if (location && location.workstationActivations.length >= subscription.plan.maxWorkstationsPerLocation) {
        throw new DomainException(
          'WORKSTATION_LIMIT_EXCEEDED',
          `Location ${location.name} has reached its workstation limit of ${subscription.plan.maxWorkstationsPerLocation}`,
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // 6. Create the workstation activation
    const activation = await this.prisma.workstationActivation.create({
      data: {
        id: crypto.randomUUID(),
        subscriptionId: subscription.id,
        locationId: locationId!,
        hardwareFingerprint: dto.hardwareFingerprint,
        workstationName: dto.workstationName,
        activationCodeId: activationCode.id,
        isActive: true,
        activatedAt: new Date(),
        initialActivationIp: requestIp ?? null,
      },
    });

    // 7. Mark the code as used
    await this.prisma.activationCode.update({
      where: { id: activationCode.id },
      data: {
        status: 'USED',
        usedAt: new Date(),
        locationId: locationId!,
        usedByActivationId: activation.id,
      },
    });

    // 8. Generate activation token
    const location = await this.prisma.location.findUnique({ where: { id: locationId! } });
    const token = this.licenseTokenService.generateToken({
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      planId: subscription.plan.id,
      planFeatures: subscription.plan.features,
      locationId: locationId!,
      locationName: location?.name ?? '',
      workstationId: activation.id,
      hardwareFingerprint: dto.hardwareFingerprint,
    });

    this.logger.log(`Workstation activated: ${dto.workstationName} (${dto.hardwareFingerprint.substring(0, 8)}...) for subscription ${subscription.id}`);

    return {
      activationToken: token.token,
      expiresAt: token.expiresAt,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        gracePeriodDays: subscription.gracePeriodDays,
      },
      location: location ? {
        id: location.id,
        name: location.name,
        address: location.address,
        city: location.city,
        region: location.region,
      } : null,
      plan: {
        id: subscription.plan.id,
        code: subscription.plan.code,
        name: subscription.plan.name,
        features: subscription.plan.features,
        maxLocations: subscription.plan.maxLocations,
        maxWorkstationsPerLocation: subscription.plan.maxWorkstationsPerLocation,
      },
      workstationActivation: {
        id: activation.id,
        workstationName: activation.workstationName,
        activatedAt: activation.activatedAt,
      },
    };
  }

  async findBySubscription(subscriptionId: string) {
    return this.prisma.workstationActivation.findMany({
      where: { subscriptionId },
      include: { location: { select: { id: true, name: true } } },
      orderBy: { activatedAt: 'desc' },
    });
  }

  async findByLocation(locationId: string) {
    return this.prisma.workstationActivation.findMany({
      where: { locationId },
      orderBy: { activatedAt: 'desc' },
    });
  }

  async revoke(activationId: string, reason?: string) {
    const activation = await this.prisma.workstationActivation.findUnique({
      where: { id: activationId },
    });
    if (!activation) {
      throw new DomainException('ACTIVATION_NOT_FOUND', 'Workstation activation not found', HttpStatus.NOT_FOUND);
    }

    return this.prisma.workstationActivation.update({
      where: { id: activationId },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedReason: reason ?? 'Revoked by admin',
      },
    });
  }

  async getActivationStatus(activationId: string) {
    const activation = await this.prisma.workstationActivation.findUnique({
      where: { id: activationId },
      include: {
        subscription: { include: { plan: true } },
        location: true,
        licenseCheckIns: { orderBy: { checkedInAt: 'desc' }, take: 10 },
      },
    });
    if (!activation) {
      throw new DomainException('ACTIVATION_NOT_FOUND', 'Workstation activation not found', HttpStatus.NOT_FOUND);
    }
    return activation;
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const groups: string[] = [];
    for (let g = 0; g < 4; g++) {
      let group = '';
      for (let i = 0; i < 4; i++) {
        group += chars[Math.floor(Math.random() * chars.length)];
      }
      groups.push(group);
    }
    const code = groups.join('-');
    const checksum = this.computeChecksum(code.replace(/-/g, ''));
    return `${code}${checksum}`;
  }

  private computeChecksum(value: string): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let sum = 0;
    for (let i = 0; i < value.length; i++) {
      const pos = chars.indexOf(value[i]);
      if (pos >= 0) {
        sum += pos * (i % 2 === 0 ? 1 : 3);
      }
    }
    const check = (10 - (sum % 10)) % 10;
    return check.toString();
  }
}
