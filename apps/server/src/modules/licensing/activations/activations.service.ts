import { Injectable, Logger, HttpStatus } from "@nestjs/common";
import { PrismaService } from "@/infrastructure/prisma/prisma.service";
import { DomainException } from "@/common/exceptions/domain.exception";
import { acquireAdvisoryLock } from "@/common/utils/advisory-lock";
import { LicenseTokenService } from "../tokens/license-token.service";
import { FraudDetectionService } from "../fraud/fraud-detection.service";
import {
  ActivationCodeStatus,
  ActivationCodeType,
} from "@pharmacy/shared-types";
import type {
  ActivationCode,
  Location,
  Prisma,
  WorkstationActivation,
} from "@pharmacy/database";
import {
  DEFAULT_SUBSCRIPTION_CODE_TTL_DAYS,
  generateActivationCode,
} from "./activation-code.utils";
import type {
  ActivateDto,
  GenerateActivationCodeDto,
} from "./dto/activation.dto";

/** Subscription with its Plan — the shape the limit checks read. */
type SubscriptionWithPlan = Prisma.SubscriptionGetPayload<{
  include: { plan: true };
}>;

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
  async generateActivationCode(
    subscriptionId: string,
    dto: GenerateActivationCodeDto,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });
    if (!subscription) {
      throw new DomainException(
        "SUBSCRIPTION_NOT_FOUND",
        "Subscription not found",
        HttpStatus.NOT_FOUND,
      );
    }
    if (!["ACTIVE", "TRIAL"].includes(subscription.status)) {
      throw new DomainException(
        "SUBSCRIPTION_NOT_ACTIVE",
        "Subscription is not active",
        HttpStatus.FORBIDDEN,
      );
    }

    const codeExpiresAt = new Date();
    codeExpiresAt.setFullYear(codeExpiresAt.getFullYear() + 1);

    // The WORKSTATION-limit validation and the code insert share the same
    // per-location advisory lock as activate(), so codes cannot be generated
    // past the plan limit while a concurrent activation is mid-commit.
    return this.prisma.$transaction((tx) =>
      this.createWorkstationCodeGuarded(tx, subscription, dto, codeExpiresAt),
    );
  }

  /**
   * Transactional body of generateActivationCode(): validates the target
   * location against the plan's workstation limit under the per-location
   * advisory lock, then inserts the code.
   */
  private async createWorkstationCodeGuarded(
    tx: Prisma.TransactionClient,
    subscription: SubscriptionWithPlan,
    dto: GenerateActivationCodeDto,
    expiresAt: Date,
  ) {
    // SUBSCRIPTION codes bootstrap new locations on activation and are only
    // ever minted internally (SubscriptionsService / checkout flow). Allowing
    // them here would let this endpoint mint unlimited-location codes and
    // bypass maxLocations entirely.
    if (dto.type === "SUBSCRIPTION") {
      throw new DomainException(
        "INVALID_CODE_TYPE_FOR_ENDPOINT",
        "SUBSCRIPTION codes are generated automatically at checkout; use WORKSTATION codes to add workstations",
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!dto.locationId) {
      throw new DomainException(
        "LOCATION_ID_REQUIRED",
        "A locationId is required to generate a WORKSTATION code",
        HttpStatus.BAD_REQUEST,
      );
    }

    await acquireAdvisoryLock(tx, `${dto.locationId}:WORKSTATION_ACTIVATION`);

    const location = await tx.location.findUnique({
      where: { id: dto.locationId },
    });
    if (!location) {
      throw new DomainException(
        "LOCATION_NOT_FOUND",
        "Location not found",
        HttpStatus.NOT_FOUND,
      );
    }
    if (location.subscriptionId !== subscription.id) {
      throw new DomainException(
        "LOCATION_MISMATCH",
        "Location does not belong to this subscription",
        HttpStatus.FORBIDDEN,
      );
    }

    const activeWorkstations = await tx.workstationActivation.count({
      where: { locationId: dto.locationId, isActive: true },
    });
    if (activeWorkstations >= subscription.plan.maxWorkstationsPerLocation) {
      throw new DomainException(
        "WORKSTATION_LIMIT_EXCEEDED",
        `Plan ${subscription.plan.code} allows max ${subscription.plan.maxWorkstationsPerLocation} workstation(s) per location. ` +
          `Location ${location.name} already has ${activeWorkstations}.`,
        HttpStatus.FORBIDDEN,
      );
    }

    return tx.activationCode.create({
      data: {
        id: crypto.randomUUID(),
        subscriptionId: subscription.id,
        locationId: dto.locationId,
        code: generateActivationCode(),
        type: "WORKSTATION",
        status: "UNUSED",
        expiresAt,
      },
    });
  }

  /**
   * Batch-generate SUBSCRIPTION activation codes for a new subscription
   * (self-service checkout flow). One code per plan-included workstation.
   */
  async generateSubscriptionCodes(
    subscriptionId: string,
    count: number,
    ttlDays: number = DEFAULT_SUBSCRIPTION_CODE_TTL_DAYS,
  ): Promise<ActivationCode[]> {
    const safeCount = Math.max(1, Math.floor(count));
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    const codes = await this.prisma.activationCode.createManyAndReturn({
      data: Array.from({ length: safeCount }, () => ({
        id: crypto.randomUUID(),
        subscriptionId,
        code: generateActivationCode(),
        type: ActivationCodeType.SUBSCRIPTION,
        status: ActivationCodeStatus.UNUSED,
        expiresAt,
      })),
    });

    this.logger.log(
      `Generated ${safeCount} activation code(s) for subscription ${subscriptionId}`,
    );
    return codes;
  }

  /**
   * Find the oldest UNUSED SUBSCRIPTION code of a subscription — the one the
   * self-service checkout returns to the POS for onboarding.
   */
  async findFirstUnusedSubscriptionCode(
    subscriptionId: string,
  ): Promise<ActivationCode | null> {
    return this.prisma.activationCode.findFirst({
      where: {
        subscriptionId,
        type: ActivationCodeType.SUBSCRIPTION,
        status: ActivationCodeStatus.UNUSED,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Public recovery flow: collect the first unused SUBSCRIPTION code of every
   * ACTIVE subscription matching taxId + email. Never throws for "no match" —
   * returns an empty list instead.
   *
   * The email comparison is an exact, case-sensitive match on the lowercased
   * input; Prisma does not lowercase automatically and stored emails are not
   * normalized, so this is acceptable per schema.
   */
  async recoverActivationCodes(
    taxId: string,
    email: string,
  ): Promise<{ codes: Array<{ code: string; expiresAt: string }> }> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        customerTaxId: taxId.trim(),
        customerEmail: email.trim().toLowerCase(),
        status: "ACTIVE",
      },
      select: { id: true },
    });

    const codes: Array<{ code: string; expiresAt: string }> = [];
    for (const subscription of subscriptions) {
      const code = await this.findFirstUnusedSubscriptionCode(subscription.id);
      if (code) {
        codes.push({
          code: code.code,
          expiresAt: code.expiresAt.toISOString(),
        });
      }
    }
    return { codes };
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
      throw new DomainException(
        "INVALID_ACTIVATION_CODE",
        "The activation code is invalid",
        HttpStatus.NOT_FOUND,
      );
    }

    if (activationCode.status !== "UNUSED") {
      throw new DomainException(
        "ACTIVATION_CODE_USED",
        `The activation code was already ${activationCode.status.toLowerCase()}`,
        HttpStatus.CONFLICT,
      );
    }

    if (new Date() > activationCode.expiresAt) {
      throw new DomainException(
        "ACTIVATION_CODE_EXPIRED",
        "The activation code has expired",
        HttpStatus.GONE,
      );
    }

    // 2. Validate subscription status
    const subscription = activationCode.subscription;
    if (!["ACTIVE", "TRIAL"].includes(subscription.status)) {
      throw new DomainException(
        "SUBSCRIPTION_NOT_ACTIVE",
        `Subscription is ${subscription.status.toLowerCase()}. Cannot activate.`,
        HttpStatus.FORBIDDEN,
      );
    }

    // 3. Run fraud detection
    const fraudResult = await this.fraudDetectionService.runActivationChecks({
      code: dto.code,
      hardwareFingerprint: dto.hardwareFingerprint,
      requestIp: requestIp ?? "unknown",
      subscriptionId: subscription.id,
      subscription,
    });

    if (fraudResult.shouldReject) {
      throw new DomainException(
        "ACTIVATION_REJECTED_FRAUD",
        `Activation rejected: ${fraudResult.reason}`,
        HttpStatus.FORBIDDEN,
      );
    }

    // 4-7. Location resolution, workstation-limit enforcement, activation
    // creation, and code consumption run in ONE transaction. The per-location
    // advisory lock inside serializes the count-then-create section: without
    // it two concurrent activations (e.g. several stations activating at once
    // after a fresh install) can both read a count below the plan limit and
    // both insert, exceeding maxWorkstationsPerLocation.
    const { activation, location } = await this.prisma.$transaction((tx) =>
      this.activateInTransaction(
        tx,
        activationCode,
        subscription,
        dto,
        requestIp,
      ),
    );

    // 8. Generate activation token (after commit — signing only, no DB access)
    const token = this.licenseTokenService.generateToken({
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      planId: subscription.plan.id,
      planFeatures: subscription.plan.features,
      locationId: activation.locationId,
      locationName: location?.name ?? "",
      workstationId: activation.id,
      hardwareFingerprint: dto.hardwareFingerprint,
    });

    this.logger.log(
      `Workstation activated: ${dto.workstationName} (${dto.hardwareFingerprint.substring(0, 8)}...) for subscription ${subscription.id}`,
    );

    return {
      activationToken: token.token,
      expiresAt: token.expiresAt,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        gracePeriodDays: subscription.gracePeriodDays,
      },
      location: location
        ? {
            id: location.id,
            name: location.name,
            address: location.address,
            city: location.city,
            region: location.region,
          }
        : null,
      plan: {
        id: subscription.plan.id,
        code: subscription.plan.code,
        name: subscription.plan.name,
        billingMethod: subscription.plan.billingMethod,
        features: subscription.plan.features,
        maxLocations: subscription.plan.maxLocations,
        maxWorkstationsPerLocation:
          subscription.plan.maxWorkstationsPerLocation,
      },
      workstationActivation: {
        id: activation.id,
        workstationName: activation.workstationName,
        activatedAt: activation.activatedAt,
      },
    };
  }

  /**
   * Transactional body of activate(): resolves/creates the location, enforces
   * the plan's per-location workstation limit under an advisory lock, creates
   * the activation, and consumes the code — all atomically.
   */
  private async activateInTransaction(
    tx: Prisma.TransactionClient,
    activationCode: ActivationCode & {
      subscription: SubscriptionWithPlan;
    },
    subscription: SubscriptionWithPlan,
    dto: ActivateDto,
    requestIp?: string,
  ): Promise<{
    activation: WorkstationActivation;
    location: Location | null;
  }> {
    let locationId = activationCode.locationId;

    // SUBSCRIPTION codes bootstrap the first location of the subscription.
    // The location count runs under the same per-subscription advisory lock
    // as LocationsService.create, so a SUBSCRIPTION code cannot create a
    // location past the plan's maxLocations while another is mid-commit —
    // previously this branch skipped the limit entirely.
    if (activationCode.type === "SUBSCRIPTION") {
      if (!dto.locationName) {
        throw new DomainException(
          "LOCATION_NAME_REQUIRED",
          "Location name is required for initial activation",
          HttpStatus.BAD_REQUEST,
        );
      }
      await acquireAdvisoryLock(tx, `${subscription.id}:LOCATION`);

      const activeLocations = await tx.location.count({
        where: { subscriptionId: subscription.id, isActive: true },
      });
      if (activeLocations >= subscription.plan.maxLocations) {
        throw new DomainException(
          "PLAN_LIMIT_EXCEEDED",
          `Plan ${subscription.plan.code} allows max ${subscription.plan.maxLocations} location(s). ` +
            `Subscription already has ${activeLocations}.`,
          HttpStatus.FORBIDDEN,
        );
      }

      const created = await tx.location.create({
        data: {
          id: crypto.randomUUID(),
          subscriptionId: subscription.id,
          name: dto.locationName,
          address: dto.locationAddress ?? null,
          city: dto.locationCity ?? null,
          region: dto.locationRegion ?? null,
          country: "CO",
          isActive: true,
        },
      });
      locationId = created.id;
    }

    // A WORKSTATION code is always bound to a location at generation time;
    // reaching this point without one is a malformed code.
    if (!locationId) {
      throw new DomainException(
        "LOCATION_NOT_ASSIGNED",
        "Activation code is not bound to a location",
        HttpStatus.BAD_REQUEST,
      );
    }

    // Serialize concurrent activations for this location before the
    // count-then-create section (see the comment at the call site).
    await acquireAdvisoryLock(tx, `${locationId}:WORKSTATION_ACTIVATION`);

    const location = await tx.location.findUnique({
      where: { id: locationId },
    });
    if (!location) {
      throw new DomainException(
        "LOCATION_NOT_FOUND",
        `Location ${locationId} does not exist`,
        HttpStatus.NOT_FOUND,
      );
    }

    const activeWorkstations = await tx.workstationActivation.count({
      where: { locationId, isActive: true },
    });
    if (activeWorkstations >= subscription.plan.maxWorkstationsPerLocation) {
      throw new DomainException(
        "WORKSTATION_LIMIT_EXCEEDED",
        `Location ${location.name} has reached its workstation limit of ${subscription.plan.maxWorkstationsPerLocation}`,
        HttpStatus.FORBIDDEN,
      );
    }

    const activation = await tx.workstationActivation.create({
      data: {
        id: crypto.randomUUID(),
        subscriptionId: subscription.id,
        locationId,
        hardwareFingerprint: dto.hardwareFingerprint,
        workstationName: dto.workstationName,
        activationCodeId: activationCode.id,
        isActive: true,
        activatedAt: new Date(),
        initialActivationIp: requestIp ?? null,
      },
    });

    await tx.activationCode.update({
      where: { id: activationCode.id },
      data: {
        status: "USED",
        usedAt: new Date(),
        locationId,
        usedByActivationId: activation.id,
      },
    });

    return { activation, location };
  }

  async findBySubscription(subscriptionId: string) {
    return this.prisma.workstationActivation.findMany({
      where: { subscriptionId },
      include: { location: { select: { id: true, name: true } } },
      orderBy: { activatedAt: "desc" },
    });
  }

  async findByLocation(locationId: string) {
    return this.prisma.workstationActivation.findMany({
      where: { locationId },
      orderBy: { activatedAt: "desc" },
    });
  }

  async revoke(activationId: string, reason?: string) {
    const activation = await this.prisma.workstationActivation.findUnique({
      where: { id: activationId },
    });
    if (!activation) {
      throw new DomainException(
        "ACTIVATION_NOT_FOUND",
        "Workstation activation not found",
        HttpStatus.NOT_FOUND,
      );
    }

    return this.prisma.workstationActivation.update({
      where: { id: activationId },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedReason: reason ?? "Revoked by admin",
      },
    });
  }

  async getActivationStatus(activationId: string) {
    const activation = await this.prisma.workstationActivation.findUnique({
      where: { id: activationId },
      include: {
        subscription: { include: { plan: true } },
        location: true,
        licenseCheckIns: { orderBy: { checkedInAt: "desc" }, take: 10 },
      },
    });
    if (!activation) {
      throw new DomainException(
        "ACTIVATION_NOT_FOUND",
        "Workstation activation not found",
        HttpStatus.NOT_FOUND,
      );
    }
    return activation;
  }

  /**
   * Find active activation by workstation name.
   * The workstation activation's `workstationName` matches the Workstation model's `name`.
   * Fully database-driven — returns the same shape as activate().
   */
  async getStatusByWorkstation(workstationId: string) {
    // 1. Resolve workstation name
    const workstation = await this.prisma.workstation.findUnique({
      where: { id: workstationId },
    });
    if (!workstation) {
      throw new DomainException(
        "WORKSTATION_NOT_FOUND",
        "Workstation not found",
        HttpStatus.NOT_FOUND,
      );
    }

    // 2. Find active activation by workstation name
    const activation = await this.prisma.workstationActivation.findFirst({
      where: {
        workstationName: workstation.name,
        isActive: true,
      },
      include: {
        subscription: { include: { plan: true } },
        location: true,
      },
    });
    if (!activation) {
      throw new DomainException(
        "NO_ACTIVE_ACTIVATION",
        `No active activation found for workstation ${workstation.name}`,
        HttpStatus.NOT_FOUND,
      );
    }

    // 3. Generate activation token
    const token = this.licenseTokenService.generateToken({
      subscriptionId: activation.subscriptionId,
      subscriptionStatus: activation.subscription.status,
      planId: activation.subscription.plan.id,
      planFeatures: activation.subscription.plan.features,
      locationId: activation.locationId,
      locationName: activation.location?.name ?? "",
      workstationId: activation.id,
      hardwareFingerprint: activation.hardwareFingerprint,
    });

    return {
      activationToken: token.token,
      expiresAt: token.expiresAt,
      subscription: {
        id: activation.subscription.id,
        status: activation.subscription.status,
        currentPeriodEnd: activation.subscription.currentPeriodEnd,
        gracePeriodDays: activation.subscription.gracePeriodDays,
      },
      location: activation.location
        ? {
            id: activation.location.id,
            name: activation.location.name,
            address: activation.location.address,
            city: activation.location.city,
            region: activation.location.region,
          }
        : null,
      plan: {
        id: activation.subscription.plan.id,
        code: activation.subscription.plan.code,
        name: activation.subscription.plan.name,
        billingMethod: activation.subscription.plan.billingMethod,
        features: activation.subscription.plan.features,
        maxLocations: activation.subscription.plan.maxLocations,
        maxWorkstationsPerLocation:
          activation.subscription.plan.maxWorkstationsPerLocation,
      },
      workstationActivation: {
        id: activation.id,
        workstationName: activation.workstationName,
        activatedAt: activation.activatedAt,
      },
    };
  }
}
