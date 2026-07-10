import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

interface ActivationContext {
  code: string;
  hardwareFingerprint: string;
  requestIp: string;
  subscriptionId: string;
  subscription: { id: string; status: string };
}

interface CheckInContext {
  activationId: string;
  subscriptionId: string;
  hardwareFingerprint: string;
  requestIp: string;
  workstation: { id: string; hardwareFingerprint: string };
}

interface FraudSignal {
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  reason: string;
  suggestedAction: 'LOG_ONLY' | 'FLAG_REVIEW' | 'RATE_LIMIT' | 'REVOKE';
  detectorName: string;
  details?: Record<string, unknown>;
}

interface FraudResult {
  shouldReject: boolean;
  reason: string | null;
  signals: FraudSignal[];
}

@Injectable()
export class FraudDetectionService {
  private readonly logger = new Logger(FraudDetectionService.name);

  // Rate limiting: max activations per IP per hour
  private readonly ACTIVATIONS_PER_HOUR_LIMIT = 5;
  private readonly ACTIVATION_WINDOW_MS = 60 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run all activation checks.
   */
  async runActivationChecks(context: ActivationContext): Promise<FraudResult> {
    const signals: FraudSignal[] = [];

    // Detector 1: Hardware fingerprint collision
    const collisionSignal = await this.checkHardwareFingerprintCollision(
      context.hardwareFingerprint,
      context.subscriptionId,
    );
    if (collisionSignal) signals.push(collisionSignal);

    // Detector 2: Activation code reuse
    const reuseSignal = await this.checkActivationCodeReuse(
      context.code,
      context.requestIp,
    );
    if (reuseSignal) signals.push(reuseSignal);

    // Detector 3: Rapid bulk activations
    const bulkSignal = await this.checkRapidBulkActivations(context.requestIp);
    if (bulkSignal) signals.push(bulkSignal);

    // Determine if we should reject
    const highSeveritySignals = signals.filter((s) => s.severity === 'HIGH');
    const shouldReject = highSeveritySignals.length > 0;

    // Write alerts
    for (const signal of signals) {
      if (signal.severity !== 'LOW') {
        await this.writeAlert(context.subscriptionId, null, signal);
      }
    }

    return {
      shouldReject,
      reason: highSeveritySignals.map((s) => s.reason).join('; ') || null,
      signals,
    };
  }

  /**
   * Run all check-in checks.
   */
  async runCheckInChecks(context: CheckInContext): Promise<FraudSignal[]> {
    const signals: FraudSignal[] = [];

    // Detector 4: Region inconsistency
    const regionSignal = await this.checkRegionInconsistency(
      context.workstation.id,
      context.requestIp,
    );
    if (regionSignal) signals.push(regionSignal);

    // Detector 5: Check-in frequency anomaly
    const frequencySignal = await this.checkCheckInFrequency(context.activationId);
    if (frequencySignal) signals.push(frequencySignal);

    // Write alerts for non-LOW signals
    for (const signal of signals) {
      if (signal.severity !== 'LOW') {
        await this.writeAlert(context.subscriptionId, context.activationId, signal);
      }
    }

    return signals;
  }

  /**
   * Report a token replay (called from CheckInsService when fingerprint doesn't match).
   */
  async reportTokenReplay(params: {
    activationId: string;
    subscriptionId: string;
    expectedFingerprint: string;
    receivedFingerprint: string;
    requestIp: string;
  }) {
    const signal: FraudSignal = {
      severity: 'HIGH',
      detectorName: 'TokenReplayDetector',
      reason: `Token replay detected: expected fingerprint ${params.expectedFingerprint.substring(0, 8)}... but received ${params.receivedFingerprint.substring(0, 8)}...`,
      suggestedAction: 'REVOKE',
      details: {
        activationId: params.activationId,
        expectedFingerprint: params.expectedFingerprint.substring(0, 16),
        receivedFingerprint: params.receivedFingerprint.substring(0, 16),
        requestIp: params.requestIp,
      },
    };

    await this.writeAlert(params.subscriptionId, params.activationId, signal);

    // Auto-revoke the activation
    await this.prisma.workstationActivation.update({
      where: { id: params.activationId },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedReason: 'Token replay from different hardware fingerprint',
      },
    });

    this.logger.warn(
      `[FRAUD] Token replay — activation ${params.activationId} revoked. IP: ${params.requestIp}`,
    );
  }

  // -----------------------------------------------------------------------
  // Detectors
  // -----------------------------------------------------------------------

  /**
   * Detector 1: Check if the same hardware fingerprint is already active
   * for a different subscription.
   */
  private async checkHardwareFingerprintCollision(
    fingerprint: string,
    subscriptionId: string,
  ): Promise<FraudSignal | null> {
    const existing = await this.prisma.workstationActivation.findFirst({
      where: {
        hardwareFingerprint: fingerprint,
        isActive: true,
        subscriptionId: { not: subscriptionId },
      },
      include: { subscription: { select: { customerName: true } } },
    });

    if (existing) {
      return {
        severity: 'HIGH',
        detectorName: 'HardwareFingerprintCollisionDetector',
        reason: `Hardware fingerprint is already active on subscription "${existing.subscription.customerName}" (${existing.subscriptionId}). Possible license sharing.`,
        suggestedAction: 'FLAG_REVIEW',
        details: {
          existingSubscriptionId: existing.subscriptionId,
          existingCustomerName: existing.subscription.customerName,
          existingActivationId: existing.id,
        },
      };
    }

    return null;
  }

  /**
   * Detector 2: Check if the same activation code was attempted from different IPs.
   */
  private async checkActivationCodeReuse(
    code: string,
    requestIp: string,
  ): Promise<FraudSignal | null> {
    // Look for recent failed activation attempts with this code
    const recentAttempts = await this.prisma.fraudAlert.count({
      where: {
        detectorName: 'ActivationCodeReuseDetector',
        reason: { contains: code.substring(0, 8) },
        detectedAt: { gte: new Date(Date.now() - 3600000) }, // Last hour
      },
    });

    if (recentAttempts >= 3) {
      return {
        severity: 'HIGH',
        detectorName: 'ActivationCodeReuseDetector',
        reason: `Activation code ${code.substring(0, 8)}... attempted from different IP addresses. Possible code theft.`,
        suggestedAction: 'REVOKE',
        details: { code: code.substring(0, 8), recentAttempts, requestIp },
      };
    }

    return null;
  }

  /**
   * Detector 3: Check for rapid bulk activations from the same IP.
   */
  private async checkRapidBulkActivations(requestIp: string): Promise<FraudSignal | null> {
    const recentActivations = await this.prisma.workstationActivation.count({
      where: {
        initialActivationIp: requestIp,
        activatedAt: { gte: new Date(Date.now() - this.ACTIVATION_WINDOW_MS) },
      },
    });

    if (recentActivations >= this.ACTIVATIONS_PER_HOUR_LIMIT) {
      return {
        severity: 'MEDIUM',
        detectorName: 'RapidBulkActivationDetector',
        reason: `${recentActivations} activations from IP ${requestIp} in the last hour. Possible bulk activation abuse.`,
        suggestedAction: 'RATE_LIMIT',
        details: { requestIp, recentActivations, limit: this.ACTIVATIONS_PER_HOUR_LIMIT },
      };
    }

    return null;
  }

  /**
   * Detector 4: Check if the check-in IP is from a different region than the initial activation IP.
   * Note: This requires a GeoIP database to be configured. Without it, this detector logs only.
   */
  private async checkRegionInconsistency(
    activationId: string,
    requestIp: string,
  ): Promise<FraudSignal | null> {
    const activation = await this.prisma.workstationActivation.findUnique({
      where: { id: activationId },
      select: { initialActivationIp: true },
    });

    if (!activation?.initialActivationIp) return null;
    if (activation.initialActivationIp === requestIp) return null;

    // In production, this would use a GeoIP database to compare regions.
    // For now, if the IPs differ significantly (different /16 subnet), flag it.
    const initialSubnet = activation.initialActivationIp.split('.').slice(0, 2).join('.');
    const currentSubnet = requestIp.split('.').slice(0, 2).join('.');

    if (initialSubnet !== currentSubnet && !requestIp.startsWith('192.168.') && !requestIp.startsWith('10.')) {
      return {
        severity: 'MEDIUM',
        detectorName: 'RegionInconsistencyDetector',
        reason: `Check-in IP (${requestIp}) differs from initial activation IP (${activation.initialActivationIp}). Possible account takeover.`,
        suggestedAction: 'FLAG_REVIEW',
        details: {
          initialIp: activation.initialActivationIp,
          currentIp: requestIp,
          activationId,
        },
      };
    }

    return null;
  }

  /**
   * Detector 5: Check if a workstation is checking in far more often than expected.
   */
  private async checkCheckInFrequency(
    activationId: string,
  ): Promise<FraudSignal | null> {
    const oneHourAgo = new Date(Date.now() - 3600000);
    const recentCheckIns = await this.prisma.licenseCheckIn.count({
      where: {
        workstationActivationId: activationId,
        checkedInAt: { gte: oneHourAgo },
      },
    });

    if (recentCheckIns > 60) {
      // More than once per minute in the last hour
      return {
        severity: 'LOW',
        detectorName: 'CheckInFrequencyDetector',
        reason: `Workstation checked in ${recentCheckIns} times in the last hour (expected ~1-2). Possible automated abuse.`,
        suggestedAction: 'LOG_ONLY',
        details: { activationId, recentCheckIns, windowHours: 1 },
      };
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private async writeAlert(
    subscriptionId: string,
    workstationActivationId: string | null,
    signal: FraudSignal,
  ): Promise<void> {
    try {
      await this.prisma.fraudAlert.create({
        data: {
          id: crypto.randomUUID(),
          subscriptionId,
          workstationActivationId,
          severity: signal.severity as 'LOW' | 'MEDIUM' | 'HIGH',
          suggestedAction: signal.suggestedAction as 'LOG_ONLY' | 'FLAG_REVIEW' | 'RATE_LIMIT' | 'REVOKE',
          status: 'OPEN',
          detectorName: signal.detectorName,
          reason: signal.reason,
          details: signal.details !== undefined ? JSON.parse(JSON.stringify(signal.details)) : undefined,
          detectedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write fraud alert: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }
}
