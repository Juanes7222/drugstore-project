jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {}
  return { PrismaClient: MockPrismaClient };
});

import { mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';
import { Logger } from '@nestjs/common';
import { FraudDetectionService } from './fraud-detection.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FraudSignal {
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  reason: string;
  suggestedAction: 'LOG_ONLY' | 'FLAG_REVIEW' | 'RATE_LIMIT' | 'REVOKE';
  detectorName: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = mockDeep<PrismaClient>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildActivationContext(overrides: Record<string, unknown> = {}) {
  return {
    code: 'ABCD-EFGH-IJKL-MNOP5',
    hardwareFingerprint: 'fp-abc123def456',
    requestIp: '203.0.113.50',
    subscriptionId: 'sub-uuid-1',
    subscription: { id: 'sub-uuid-1', status: 'ACTIVE' },
    ...overrides,
  };
}

function buildCheckInContext(overrides: Record<string, unknown> = {}) {
  return {
    activationId: 'activation-uuid-1',
    subscriptionId: 'sub-uuid-1',
    hardwareFingerprint: 'fp-abc123def456',
    requestIp: '203.0.113.50',
    workstation: { id: 'activation-uuid-1', hardwareFingerprint: 'fp-abc123def456' },
    ...overrides,
  };
}

function buildFraudSignal(overrides: Partial<FraudSignal> = {}): FraudSignal {
  return {
    severity: 'HIGH',
    detectorName: 'TestDetector',
    reason: 'Test reason',
    suggestedAction: 'FLAG_REVIEW',
    ...overrides,
  };
}

/**
 * Helper to suppress Logger output during tests that expect error logging.
 * Returns true if Logger.error was called during the callback.
 */
async function captureLoggerErrors(fn: () => Promise<void>): Promise<boolean> {
  const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  try {
    await fn();
    return spy.mock.calls.length > 0;
  } finally {
    spy.mockRestore();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FraudDetectionService', () => {
  let service: FraudDetectionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FraudDetectionService(mockPrisma as any);
  });

  // -----------------------------------------------------------------------
  // checkHardwareFingerprintCollision
  // -----------------------------------------------------------------------
  describe('checkHardwareFingerprintCollision', () => {
    it('detects collision across subscriptions returning HIGH severity', async () => {
      const existingActivation = {
        id: 'existing-act-uuid',
        subscriptionId: 'other-sub-uuid',
        isActive: true,
        subscription: { customerName: 'Other Pharmacy' },
      };
      mockPrisma.workstationActivation.findFirst.mockResolvedValue(existingActivation as any);

      const signal = await (service as any).checkHardwareFingerprintCollision(
        'fp-abc123def456',
        'sub-uuid-1',
      );

      expect(signal).not.toBeNull();
      expect(signal.severity).toBe('HIGH');
      expect(signal.detectorName).toBe('HardwareFingerprintCollisionDetector');
      expect(signal.suggestedAction).toBe('FLAG_REVIEW');
      expect(signal.details!.existingSubscriptionId).toBe('other-sub-uuid');
      expect(signal.reason).toContain('Other Pharmacy');
    });

    it('returns null if no collision found', async () => {
      mockPrisma.workstationActivation.findFirst.mockResolvedValue(null);

      const signal = await (service as any).checkHardwareFingerprintCollision(
        'fp-abc123def456',
        'sub-uuid-1',
      );

      expect(signal).toBeNull();
    });

    it('queries with correct where clause excluding current subscription', async () => {
      mockPrisma.workstationActivation.findFirst.mockResolvedValue(null);

      await (service as any).checkHardwareFingerprintCollision('fp-unique', 'sub-uuid-1');

      expect(mockPrisma.workstationActivation.findFirst).toHaveBeenCalledWith({
        where: {
          hardwareFingerprint: 'fp-unique',
          isActive: true,
          subscriptionId: { not: 'sub-uuid-1' },
        },
        include: { subscription: { select: { customerName: true } } },
      });
    });
  });

  // -----------------------------------------------------------------------
  // checkActivationCodeReuse
  // -----------------------------------------------------------------------
  describe('checkActivationCodeReuse', () => {
    it('flags after 3+ recent attempts with HIGH severity and REVOKE action', async () => {
      mockPrisma.fraudAlert.count.mockResolvedValue(3);

      const signal = await (service as any).checkActivationCodeReuse(
        'ABCD-EFGH-IJKL-MNOP5',
        '203.0.113.50',
      );

      expect(signal).not.toBeNull();
      expect(signal.severity).toBe('HIGH');
      expect(signal.detectorName).toBe('ActivationCodeReuseDetector');
      expect(signal.suggestedAction).toBe('REVOKE');
      // code.substring(0,8) of "ABCD-EFGH-IJKL-MNOP5" → "ABCD-EFG"
      expect(signal.reason).toContain('ABCD-EFG');
    });

    it('returns null if under threshold', async () => {
      mockPrisma.fraudAlert.count.mockResolvedValue(2);

      const signal = await (service as any).checkActivationCodeReuse(
        'ABCD-EFGH-IJKL-MNOP5',
        '203.0.113.50',
      );

      expect(signal).toBeNull();
    });

    it('searches alerts with partial code match in the last hour', async () => {
      mockPrisma.fraudAlert.count.mockResolvedValue(0);

      await (service as any).checkActivationCodeReuse('ABCD-EFGH-IJKL-MNOP5', '203.0.113.50');

      expect(mockPrisma.fraudAlert.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            detectorName: 'ActivationCodeReuseDetector',
            // code.substring(0,8) of "ABCD-EFGH-IJKL-MNOP5" → "ABCD-EFG" (A,B,C,D,-,E,F,G)
            reason: { contains: 'ABCD-EFG' },
            detectedAt: { gte: expect.any(Date) },
          }),
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // checkRapidBulkActivations
  // -----------------------------------------------------------------------
  describe('checkRapidBulkActivations', () => {
    it('flags 5+ activations per hour with MEDIUM severity', async () => {
      mockPrisma.workstationActivation.count.mockResolvedValue(5);

      const signal = await (service as any).checkRapidBulkActivations('203.0.113.50');

      expect(signal).not.toBeNull();
      expect(signal.severity).toBe('MEDIUM');
      expect(signal.detectorName).toBe('RapidBulkActivationDetector');
      expect(signal.suggestedAction).toBe('RATE_LIMIT');
      expect(signal.reason).toContain('5 activations');
    });

    it('returns null if under threshold', async () => {
      mockPrisma.workstationActivation.count.mockResolvedValue(4);

      const signal = await (service as any).checkRapidBulkActivations('203.0.113.50');

      expect(signal).toBeNull();
    });

    it('counts activations from the same IP within the last hour', async () => {
      mockPrisma.workstationActivation.count.mockResolvedValue(0);

      await (service as any).checkRapidBulkActivations('203.0.113.50');

      expect(mockPrisma.workstationActivation.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            initialActivationIp: '203.0.113.50',
            activatedAt: { gte: expect.any(Date) },
          }),
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // checkRegionInconsistency
  // -----------------------------------------------------------------------
  describe('checkRegionInconsistency', () => {
    const ACTIVATION_ID = 'activation-uuid-1';

    it('flags different IP subnets with MEDIUM severity', async () => {
      mockPrisma.workstationActivation.findUnique.mockResolvedValue({
        initialActivationIp: '203.0.113.100',
      } as any);

      const signal = await (service as any).checkRegionInconsistency(ACTIVATION_ID, '198.51.100.200');

      expect(signal).not.toBeNull();
      expect(signal.severity).toBe('MEDIUM');
      expect(signal.detectorName).toBe('RegionInconsistencyDetector');
      expect(signal.suggestedAction).toBe('FLAG_REVIEW');
      expect(signal.reason).toContain('198.51.100.200');
      expect(signal.reason).toContain('203.0.113.100');
    });

    it('returns null if IPs are identical', async () => {
      mockPrisma.workstationActivation.findUnique.mockResolvedValue({
        initialActivationIp: '203.0.113.50',
      } as any);

      const signal = await (service as any).checkRegionInconsistency(ACTIVATION_ID, '203.0.113.50');

      expect(signal).toBeNull();
    });

    it('skips check if requestIp is private (192.168.x)', async () => {
      mockPrisma.workstationActivation.findUnique.mockResolvedValue({
        initialActivationIp: '203.0.113.100',
      } as any);

      const signal = await (service as any).checkRegionInconsistency(ACTIVATION_ID, '192.168.1.50');

      expect(signal).toBeNull();
    });

    it('skips check if requestIp is private (10.x)', async () => {
      mockPrisma.workstationActivation.findUnique.mockResolvedValue({
        initialActivationIp: '203.0.113.100',
      } as any);

      const signal = await (service as any).checkRegionInconsistency(ACTIVATION_ID, '10.0.0.50');

      expect(signal).toBeNull();
    });

    it('returns null if activation has no initial IP set', async () => {
      mockPrisma.workstationActivation.findUnique.mockResolvedValue({
        initialActivationIp: null,
      } as any);

      const signal = await (service as any).checkRegionInconsistency(ACTIVATION_ID, '203.0.113.50');

      expect(signal).toBeNull();
    });

    it('returns null if activation is not found', async () => {
      mockPrisma.workstationActivation.findUnique.mockResolvedValue(null);

      const signal = await (service as any).checkRegionInconsistency(ACTIVATION_ID, '203.0.113.50');

      expect(signal).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // checkCheckInFrequency
  // -----------------------------------------------------------------------
  describe('checkCheckInFrequency', () => {
    it('flags 60+ check-ins per hour with LOW severity', async () => {
      mockPrisma.licenseCheckIn.count.mockResolvedValue(61);

      const signal = await (service as any).checkCheckInFrequency('activation-uuid-1');

      expect(signal).not.toBeNull();
      expect(signal.severity).toBe('LOW');
      expect(signal.detectorName).toBe('CheckInFrequencyDetector');
      expect(signal.suggestedAction).toBe('LOG_ONLY');
      expect(signal.reason).toContain('61');
    });

    it('returns null if under threshold', async () => {
      mockPrisma.licenseCheckIn.count.mockResolvedValue(30);

      const signal = await (service as any).checkCheckInFrequency('activation-uuid-1');

      expect(signal).toBeNull();
    });

    it('counts check-ins for the given activation in the last hour', async () => {
      mockPrisma.licenseCheckIn.count.mockResolvedValue(0);

      await (service as any).checkCheckInFrequency('activation-uuid-1');

      expect(mockPrisma.licenseCheckIn.count).toHaveBeenCalledWith({
        where: {
          workstationActivationId: 'activation-uuid-1',
          checkedInAt: { gte: expect.any(Date) },
        },
      });
    });
  });

  // -----------------------------------------------------------------------
  // reportTokenReplay
  // -----------------------------------------------------------------------
  describe('reportTokenReplay', () => {
    it('creates a fraud alert and auto-revokes the activation', async () => {
      mockPrisma.fraudAlert.create.mockResolvedValue({} as any);
      mockPrisma.workstationActivation.update.mockResolvedValue({} as any);

      await service.reportTokenReplay({
        activationId: 'activation-uuid-1',
        subscriptionId: 'sub-uuid-1',
        expectedFingerprint: 'fp-abc123def456',
        receivedFingerprint: 'fp-xyz789ghi012',
        requestIp: '203.0.113.50',
      });

      expect(mockPrisma.fraudAlert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: 'sub-uuid-1',
            workstationActivationId: 'activation-uuid-1',
            severity: 'HIGH',
            suggestedAction: 'REVOKE',
            detectorName: 'TokenReplayDetector',
          }),
        }),
      );

      expect(mockPrisma.workstationActivation.update).toHaveBeenCalledWith({
        where: { id: 'activation-uuid-1' },
        data: {
          isActive: false,
          revokedAt: expect.any(Date),
          revokedReason: 'Token replay from different hardware fingerprint',
        },
      });
    });

    it('auto-revocation sets isActive to false', async () => {
      mockPrisma.fraudAlert.create.mockResolvedValue({} as any);
      mockPrisma.workstationActivation.update.mockResolvedValue({} as any);

      await service.reportTokenReplay({
        activationId: 'activation-uuid-1',
        subscriptionId: 'sub-uuid-1',
        expectedFingerprint: 'fp-abc123def456',
        receivedFingerprint: 'fp-xyz789ghi012',
        requestIp: '203.0.113.50',
      });

      const updateData = mockPrisma.workstationActivation.update.mock.calls[0][0].data;
      expect(updateData.isActive).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // runActivationChecks — aggregates all activation detectors
  // -----------------------------------------------------------------------
  describe('runActivationChecks', () => {
    it('rejects when a HIGH severity signal is detected', async () => {
      // Make collision detector return a HIGH signal
      mockPrisma.workstationActivation.findFirst.mockResolvedValue({
        id: 'existing-act-uuid',
        subscriptionId: 'other-sub-uuid',
        isActive: true,
        subscription: { customerName: 'Other Pharmacy' },
      } as any);
      // Others return null
      mockPrisma.fraudAlert.count.mockResolvedValue(0);
      mockPrisma.workstationActivation.count.mockResolvedValue(0);

      const result = await service.runActivationChecks(buildActivationContext());

      expect(result.shouldReject).toBe(true);
      expect(result.reason).not.toBeNull();
      expect(result.signals.length).toBeGreaterThan(0);
    });

    it('does not reject when no HIGH signals are found', async () => {
      // All detectors return null / no HIGH
      mockPrisma.workstationActivation.findFirst.mockResolvedValue(null);
      mockPrisma.fraudAlert.count.mockResolvedValue(0);
      mockPrisma.workstationActivation.count.mockResolvedValue(0);

      const result = await service.runActivationChecks(buildActivationContext());

      expect(result.shouldReject).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('writes alerts for non-LOW signals', async () => {
      // Make bulk activation detector return MEDIUM
      mockPrisma.workstationActivation.findFirst.mockResolvedValue(null);
      mockPrisma.fraudAlert.count.mockResolvedValue(0);
      mockPrisma.workstationActivation.count.mockResolvedValue(5); // Triggers MEDIUM
      mockPrisma.fraudAlert.create.mockResolvedValue({} as any);

      const result = await service.runActivationChecks(buildActivationContext());

      expect(mockPrisma.fraudAlert.create).toHaveBeenCalledTimes(1);
      expect(result.signals.length).toBe(1);
    });

    it('skips writing alerts for LOW severity signals', async () => {
      mockPrisma.workstationActivation.findFirst.mockResolvedValue(null);
      mockPrisma.fraudAlert.count.mockResolvedValue(0);
      mockPrisma.workstationActivation.count.mockResolvedValue(0);
      // No detector returns non-LOW → no writeAlert calls

      await service.runActivationChecks(buildActivationContext());

      expect(mockPrisma.fraudAlert.create).not.toHaveBeenCalled();
    });

    it('aggregates multiple signals into the result', async () => {
      // Collision detector returns HIGH, bulk returns MEDIUM
      mockPrisma.workstationActivation.findFirst.mockResolvedValue({
        id: 'existing-act-uuid',
        subscriptionId: 'other-sub-uuid',
        isActive: true,
        subscription: { customerName: 'Other Pharmacy' },
      } as any);
      mockPrisma.fraudAlert.count.mockResolvedValue(0);
      mockPrisma.workstationActivation.count.mockResolvedValue(5); // MEDIUM
      mockPrisma.fraudAlert.create.mockResolvedValue({} as any);

      const result = await service.runActivationChecks(buildActivationContext());

      expect(result.signals.length).toBe(2);
      expect(result.shouldReject).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // runCheckInChecks — aggregates check-in detectors
  // -----------------------------------------------------------------------
  describe('runCheckInChecks', () => {
    it('returns region and frequency signals when both trigger', async () => {
      // Region inconsistency — different /16 subnets that are not private
      mockPrisma.workstationActivation.findUnique.mockResolvedValue({
        initialActivationIp: '198.51.100.100',
      } as any);
      // Frequency
      mockPrisma.licenseCheckIn.count.mockResolvedValue(61);

      const signals = await service.runCheckInChecks(buildCheckInContext());

      expect(signals.length).toBe(2);
      expect(signals.some((s) => s.detectorName === 'RegionInconsistencyDetector')).toBe(true);
      expect(signals.some((s) => s.detectorName === 'CheckInFrequencyDetector')).toBe(true);
    });

    it('does not write alerts for LOW frequency signals', async () => {
      mockPrisma.workstationActivation.findUnique.mockResolvedValue({
        initialActivationIp: '198.51.100.100',
      } as any);
      mockPrisma.licenseCheckIn.count.mockResolvedValue(61);
      mockPrisma.fraudAlert.create.mockResolvedValue({} as any);

      const signals = await service.runCheckInChecks(buildCheckInContext());

      // Only the region signal (MEDIUM) should cause a writeAlert call
      // The frequency signal is LOW and should be skipped
      const alertCalls = mockPrisma.fraudAlert.create.mock.calls;
      const regionAlertCalls = alertCalls.filter(
        (call) => call[0].data.detectorName === 'RegionInconsistencyDetector',
      );
      const frequencyAlertCalls = alertCalls.filter(
        (call) => call[0].data.detectorName === 'CheckInFrequencyDetector',
      );

      expect(regionAlertCalls.length).toBe(1);
      expect(frequencyAlertCalls.length).toBe(0);
    });

    it('returns empty array when no detectors trigger', async () => {
      mockPrisma.workstationActivation.findUnique.mockResolvedValue({
        initialActivationIp: '203.0.113.50', // Same IP as context
      } as any);
      mockPrisma.licenseCheckIn.count.mockResolvedValue(30); // Under threshold

      const signals = await service.runCheckInChecks(buildCheckInContext());

      expect(signals).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // writeAlert (private — error handling)
  // -----------------------------------------------------------------------
  describe('writeAlert', () => {
    it('writes a fraud alert to the database', async () => {
      mockPrisma.fraudAlert.create.mockResolvedValue({} as any);

      await (service as any).writeAlert(
        'sub-uuid-1',
        'activation-uuid-1',
        buildFraudSignal({ severity: 'MEDIUM', detectorName: 'TestDetector' }),
      );

      expect(mockPrisma.fraudAlert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: 'sub-uuid-1',
            workstationActivationId: 'activation-uuid-1',
            severity: 'MEDIUM',
            status: 'OPEN',
            detectorName: 'TestDetector',
          }),
        }),
      );
    });

    it('does not throw when database write fails — logs error instead', async () => {
      mockPrisma.fraudAlert.create.mockRejectedValue(new Error('DB connection lost'));

      const wasLogged = await captureLoggerErrors(async () => {
        await (service as any).writeAlert(
          'sub-uuid-1',
          'activation-uuid-1',
          buildFraudSignal(),
        );
      });

      expect(wasLogged).toBe(true);
    });

    it('handles non-Error thrown in database write gracefully', async () => {
      mockPrisma.fraudAlert.create.mockRejectedValue('String error');

      const wasLogged = await captureLoggerErrors(async () => {
        await (service as any).writeAlert(
          'sub-uuid-1',
          null,
          buildFraudSignal({ severity: 'LOW' }),
        );
      });

      expect(wasLogged).toBe(true);
    });
  });
});
