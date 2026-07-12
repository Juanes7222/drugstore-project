import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BinaryStorageService } from './binary-storage.service';
import { TelemetryService } from './telemetry.service';
import {
  VersionNotFoundException,
  VersionAlreadyExistsException,
  VersionNotActiveException,
  RolloutAlreadyPausedException,
  RolloutNotPausedException,
} from './exceptions';
import { createHash } from 'node:crypto';

/**
 * Core service for the auto-update system.
 *
 * Responsibilities:
 * - Publishing new update versions (with binary storage)
 * - The public check endpoint logic (cohort calculation, plan checks)
 * - Rollout advancement, pausing, and rollback
 * - Admin queries for the update dashboard
 */
@Injectable()
export class UpdatesService {
  private readonly logger = new Logger(UpdatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly binaryStorage: BinaryStorageService,
    private readonly telemetryService: TelemetryService,
  ) {}

  // ---------------------------------------------------------------------------
  // Publishing
  // ---------------------------------------------------------------------------

  /**
   * Publish a new update version.  Creates the version in DRAFT state with
   * the binary stored and the SHA-256 hash computed.
   */
  async publishVersion(data: {
    version: string;
    channel: 'STABLE' | 'BETA';
    releaseNotes: string;
    updateType: 'CRITICAL' | 'MANDATORY' | 'OPTIONAL' | 'HOTFIX';
    rolloutStrategy: 'PHASED' | 'INSTANT';
    rolloutSchedule?: Array<{ percent: number; afterDays: number }>;
    mandatoryFrom?: string | null;
    minAppVersion?: string | null;
    maxAppVersion?: string | null;
    requiredPlanFeatures?: string[];
    minPlan?: string | null;
    binaryFilename: string;
    binaryBuffer: Buffer;
    signature: string;
  }) {
    // Check for duplicate version + channel
    const existing = await this.prisma.updateVersion.findUnique({
      where: { version_channel: { version: data.version, channel: data.channel as any } },
    });
    if (existing) {
      throw new VersionAlreadyExistsException(data.version, data.channel);
    }

    // Store the binary
    const { fileHash, downloadUrl, fileSize } = this.binaryStorage.storeBinary(
      data.channel,
      data.version,
      data.binaryFilename,
      data.binaryBuffer,
    );

    const defaultSchedule = [
      { percent: 5, afterDays: 0 },
      { percent: 25, afterDays: 3 },
      { percent: 50, afterDays: 7 },
      { percent: 100, afterDays: 14 },
    ];

    const version = await this.prisma.updateVersion.create({
      data: {
        id: crypto.randomUUID(),
        version: data.version,
        channel: data.channel as any,
        downloadUrl,
        signature: data.signature,
        fileSize,
        fileHash,
        releaseNotes: data.releaseNotes ?? '',
        releaseDate: new Date(),
        updateType: data.updateType as any,
        state: 'DRAFT' as any,
        rolloutStrategy: data.rolloutStrategy as any,
        rolloutStartDate: new Date(),
        rolloutSchedule: JSON.stringify(data.rolloutSchedule ?? defaultSchedule),
        minAppVersion: data.minAppVersion,
        maxAppVersion: data.maxAppVersion,
        requiredPlanFeatures: data.requiredPlanFeatures ?? [],
        minPlan: data.minPlan,
        isActive: false,
        isPaused: false,
      },
    });

    this.logger.log(`Published version ${data.version} (${data.channel}) in DRAFT state`);
    return version;
  }

  /**
   * Activate a draft version — sets isActive = true, state = ROLLING_OUT.
   */
  async activateVersion(versionId: string) {
    const version = await this.prisma.updateVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new VersionNotFoundException(versionId);

    const updated = await this.prisma.updateVersion.update({
      where: { id: versionId },
      data: {
        isActive: true,
        state: 'ROLLING_OUT' as any,
      },
    });

    this.logger.log(`Activated version ${version.version} for rollout`);
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Check logic
  // ---------------------------------------------------------------------------

  /**
   * The public update check — the core algorithm that decides whether a given
   * workstation should receive an update notification.
   */
  async checkForUpdate(params: {
    currentVersion: string;
    workstationId: string;
    channel: 'STABLE' | 'BETA';
    licensePlanCode?: string;
  }) {
    // 1. Find the latest active version for the channel
    const latestVersion = await this.prisma.updateVersion.findFirst({
      where: {
        channel: params.channel as any,
        isActive: true,
        isPaused: false,
        state: { notIn: ['ROLLED_BACK'] as any[] },
      },
      orderBy: { releaseDate: 'desc' },
    });

    if (!latestVersion) {
      return { updateAvailable: false };
    }

    // 2. Compare versions — if current >= latest, no update
    if (this.compareSemver(params.currentVersion, latestVersion.version) >= 0) {
      return { updateAvailable: false };
    }

    // 3. Check min/max app version constraints
    if (latestVersion.minAppVersion) {
      if (this.compareSemver(params.currentVersion, latestVersion.minAppVersion) < 0) {
        return {
          updateAvailable: false,
          reason: 'VERSION_TOO_LOW',
        };
      }
    }
    if (latestVersion.maxAppVersion) {
      if (this.compareSemver(params.currentVersion, latestVersion.maxAppVersion) > 0) {
        return {
          updateAvailable: false,
          reason: 'VERSION_TOO_HIGH',
        };
      }
    }

    // 4. Check plan requirements
    if (latestVersion.minPlan && params.licensePlanCode) {
      if (!this.planMeetsRequirement(params.licensePlanCode, latestVersion.minPlan)) {
        return {
          updateAvailable: false,
          reason: 'REQUIRES_PLAN_UPGRADE',
        };
      }
    }

    // 5. Apply rollout cohort calculation
    let rolloutPercentage = 100;
    if (latestVersion.rolloutStrategy === 'PHASED') {
      const schedule = this.parseRolloutSchedule(latestVersion.rolloutSchedule);
      const daysSinceRollout = Math.floor(
        (Date.now() - new Date(latestVersion.rolloutStartDate).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      const currentStep = this.getCurrentRolloutStep(schedule, daysSinceRollout);
      rolloutPercentage = currentStep?.percent ?? 100;

      // Cohort based on hash(workstationId) mod 100
      const workstationCohort = this.computeWorkstationCohort(params.workstationId);
      if (workstationCohort >= rolloutPercentage) {
        return {
          updateAvailable: false,
          reason: 'NOT_IN_COHORT',
          rolloutPercentage,
        };
      }
    }

    // 6. All checks passed — return the update
    return {
      updateAvailable: true,
      version: latestVersion.version,
      downloadUrl: latestVersion.downloadUrl,
      signature: latestVersion.signature,
      fileSize: latestVersion.fileSize,
      fileHash: latestVersion.fileHash,
      releaseNotes: latestVersion.releaseNotes,
      updateType: latestVersion.updateType,
      mandatoryFrom: latestVersion.mandatoryFrom?.toISOString() ?? null,
      rolloutPercentage,
      minAppVersion: latestVersion.minAppVersion,
      maxAppVersion: latestVersion.maxAppVersion,
    };
  }

  // ---------------------------------------------------------------------------
  // Version management
  // ---------------------------------------------------------------------------

  async listVersions() {
    return this.prisma.updateVersion.findMany({
      orderBy: { releaseDate: 'desc' },
    });
  }

  async getVersionDetails(versionId: string) {
    const version = await this.prisma.updateVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new VersionNotFoundException(versionId);

    const [successRate, uniqueWorkstations, errorBreakdown, failedWorkstations] =
      await Promise.all([
        this.telemetryService.getVersionSuccessRate(versionId),
        this.telemetryService.countUniqueWorkstationsInstalled(versionId),
        this.telemetryService.getErrorBreakdown(versionId),
        this.telemetryService.getFailedWorkstations(versionId),
      ]);

    return {
      ...version,
      rolloutSchedule: this.parseRolloutSchedule(version.rolloutSchedule),
      telemetry: {
        successRate: successRate.successRate,
        totalInstalls: successRate.totalInstalls,
        totalRollbacks: successRate.totalRollbacks,
        uniqueWorkstations,
        errorBreakdown,
        failedWorkstations,
      },
    };
  }

  async pauseRollout(versionId: string, reason?: string) {
    const version = await this.prisma.updateVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new VersionNotFoundException(versionId);
    if (version.isPaused) throw new RolloutAlreadyPausedException(versionId);

    return this.prisma.updateVersion.update({
      where: { id: versionId },
      data: { isPaused: true, pausedReason: reason ?? null, state: 'PAUSED' as any },
    });
  }

  async resumeRollout(versionId: string) {
    const version = await this.prisma.updateVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new VersionNotFoundException(versionId);
    if (!version.isPaused) throw new RolloutNotPausedException(versionId);

    return this.prisma.updateVersion.update({
      where: { id: versionId },
      data: { isPaused: false, pausedReason: null, state: 'ROLLING_OUT' as any },
    });
  }

  async rollbackVersion(versionId: string) {
    const version = await this.prisma.updateVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new VersionNotFoundException(versionId);

    return this.prisma.updateVersion.update({
      where: { id: versionId },
      data: { state: 'ROLLED_BACK' as any, isActive: false, isPaused: false },
    });
  }

  // ---------------------------------------------------------------------------
  // Channel opt-in
  // ---------------------------------------------------------------------------

  async setChannelOptIn(locationId: string, channel: 'STABLE' | 'BETA', optedInByUserId: string) {
    return this.prisma.updateChannelConfig.upsert({
      where: { locationId },
      create: {
        id: crypto.randomUUID(),
        locationId,
        channel: channel as any,
        optedInByUserId,
      },
      update: {
        channel: channel as any,
        optedInByUserId,
      },
    });
  }

  async getChannelOptIns(): Promise<
    Array<{ locationId: string; channel: 'STABLE' | 'BETA' }>
  > {
    const configs = await this.prisma.updateChannelConfig.findMany();
    return configs.map((c) => ({
      locationId: c.locationId,
      channel: c.channel as 'STABLE' | 'BETA',
    }));
  }

  /**
   * Resolve the effective channel for a location.
   * If the location has opted into BETA, return BETA; otherwise STABLE.
   */
  async resolveEffectiveChannel(locationId: string): Promise<'STABLE' | 'BETA'> {
    const config = await this.prisma.updateChannelConfig.findUnique({
      where: { locationId },
    });
    if (config && config.channel === 'BETA') return 'BETA';
    return 'STABLE';
  }

  // ---------------------------------------------------------------------------
  // Rollout advancement
  // ---------------------------------------------------------------------------

  /**
   * Evaluate all active rollouts and advance or pause them based on telemetry.
   * Called by the scheduled job (RolloutAdvancementJob).
   */
  async evaluateRollouts(): Promise<Array<{ versionId: string; action: string }>> {
    const activeVersions = await this.prisma.updateVersion.findMany({
      where: {
        isActive: true,
        isPaused: false,
        state: 'ROLLING_OUT' as any,
        rolloutStrategy: 'PHASED' as any,
      },
    });

    const results: Array<{ versionId: string; action: string }> = [];

    for (const version of activeVersions) {
      const action = await this.evaluateSingleRollout(version);
      if (action) {
        results.push({ versionId: version.id, action });
      }
    }

    return results;
  }

  private async evaluateSingleRollout(
    version: any,
  ): Promise<string | null> {
    const schedule = this.parseRolloutSchedule(version.rolloutSchedule);
    const daysSinceRollout = Math.floor(
      (Date.now() - new Date(version.rolloutStartDate).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    const currentStepIndex = schedule.findIndex(
      (s) => daysSinceRollout >= s.afterDays,
    );

    // Already at max rollout
    if (currentStepIndex >= schedule.length - 1) {
      // Check if fully deployed
      const uniqueWorkstations =
        await this.telemetryService.countUniqueWorkstationsInstalled(version.id);
      if (uniqueWorkstations > 0) {
        await this.prisma.updateVersion.update({
          where: { id: version.id },
          data: { state: 'FULLY_DEPLOYED' as any },
        });
        return 'FULLY_DEPLOYED';
      }
      return null;
    }

    // Check success rate over last 24 hours
    const { successRate, totalInstalls } =
      await this.telemetryService.getVersionSuccessRate(version.id, 24);

    // Auto-pause if success rate is too low (below 90%)
    if (totalInstalls >= 10 && successRate < 0.9) {
      await this.prisma.updateVersion.update({
        where: { id: version.id },
        data: {
          isPaused: true,
          pausedReason: `Auto-paused: success rate ${(successRate * 100).toFixed(1)}% below 90% threshold`,
          state: 'PAUSED' as any,
        },
      });
      return 'PAUSED_LOW_SUCCESS';
    }

    // Advance if: success rate >= 95% AND at least 100 workstations installed
    // OR 50% of the expected cohort has installed
    const nextStep = schedule[currentStepIndex + 1];
    if (!nextStep) return null;

    const expectedCohortSize = Math.max(
      Math.floor((nextStep.percent / 100) * 1000),
      100,
    );

    if (
      successRate >= 0.95 &&
      (totalInstalls >= 100 || totalInstalls >= expectedCohortSize * 0.5)
    ) {
      this.logger.log(
        `Advancing rollout for ${version.version}: step ${currentStepIndex + 1} → ${nextStep.percent}%`,
      );
      return 'ADVANCED';
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Compare two semver strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
   */
  private compareSemver(a: string, b: string): number {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aVal = aParts[i] ?? 0;
      const bVal = bParts[i] ?? 0;
      if (aVal < bVal) return -1;
      if (aVal > bVal) return 1;
    }
    return 0;
  }

  /**
   * Compute the workstation's cohort percentile (0-99) by hashing its ID.
   */
  private computeWorkstationCohort(workstationId: string): number {
    const hash = createHash('md5').update(workstationId).digest('hex');
    const num = parseInt(hash.substring(0, 8), 16);
    return num % 100;
  }

  /**
   * Parse the rollout schedule from JSON to a typed array.
   */
  private parseRolloutSchedule(
    schedule: any,
  ): Array<{ percent: number; afterDays: number }> {
    if (typeof schedule === 'string') {
      try {
        return JSON.parse(schedule);
      } catch {
        return [{ percent: 100, afterDays: 0 }];
      }
    }
    if (Array.isArray(schedule)) return schedule;
    return [{ percent: 100, afterDays: 0 }];
  }

  /**
   * Get the current rollout step based on days since start.
   */
  private getCurrentRolloutStep(
    schedule: Array<{ percent: number; afterDays: number }>,
    daysSinceRollout: number,
  ): { percent: number; afterDays: number } | null {
    let currentStep = schedule[0];
    for (const step of schedule) {
      if (daysSinceRollout >= step.afterDays) {
        currentStep = step;
      }
    }
    return currentStep ?? null;
  }

  /**
   * Check if the workstation's plan meets the requirement.
   * Plans have a hierarchy: PRO > BASIC > STARTER (etc).
   */
  private planMeetsRequirement(
    workstationPlan: string,
    requiredPlan: string,
  ): boolean {
    const planHierarchy = ['STARTER', 'BASIC', 'PRO', 'ENTERPRISE'];
    const wsIndex = planHierarchy.indexOf(workstationPlan.toUpperCase());
    const reqIndex = planHierarchy.indexOf(requiredPlan.toUpperCase());
    if (reqIndex === -1) return true; // unknown required plan = no constraint
    if (wsIndex === -1) return false; // unknown workstation plan = assume insufficient
    return wsIndex >= reqIndex;
  }
}
