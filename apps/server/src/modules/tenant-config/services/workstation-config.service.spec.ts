// ---------------------------------------------------------------------------
// Tests for WorkstationConfigService — per-workstation config overrides
// stored in SystemConfig key-value store.
// ---------------------------------------------------------------------------

// Mock before any imports that depend on the generated Prisma client
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
  SystemModule: { CONFIGURATION: 'CONFIGURATION' },
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { WorkstationConfigService } from './workstation-config.service';
import { NotFoundException } from '@nestjs/common';

describe('WorkstationConfigService', () => {
  let service: WorkstationConfigService;
  let prisma: DeepMockProxy<PrismaClient>;

  const SUBSCRIPTION_ID = 'sub-1';
  const WORKSTATION_ID = 'ws-1';
  const CONFIG_KEY = `ws_config:${SUBSCRIPTION_ID}:${WORKSTATION_ID}`;

  const mockSystemConfigRow = {
    key: CONFIG_KEY,
    value: {
      workflow: { autoPrintOnConfirm: false, printDuplicateReceipt: true },
      strictness: { cashShiftRequired: false, receiptPrintRequired: 'OPTIONAL' },
      subscriptionId: SUBSCRIPTION_ID,
      workstationId: WORKSTATION_ID,
    },
    valueType: 'OBJECT',
    module: 'CONFIGURATION',
    description: `Workstation-specific config overrides for ${WORKSTATION_ID}`,
    isSensitive: false,
    updatedAt: new Date('2026-07-17T12:00:00Z'),
  };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new WorkstationConfigService(prisma as any);
  });

  // ── getByWorkstation ──────────────────────────────────────────────────

  describe('getByWorkstation', () => {
    it('returns workstation config when it exists', async () => {
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(mockSystemConfigRow);

      const result = await service.getByWorkstation(SUBSCRIPTION_ID, WORKSTATION_ID);

      expect(result).not.toBeNull();
      expect(result!.subscriptionId).toBe(SUBSCRIPTION_ID);
      expect(result!.workstationId).toBe(WORKSTATION_ID);
      expect(result!.workflow.autoPrintOnConfirm).toBe(false);
      expect(result!.strictness.cashShiftRequired).toBe(false);
      expect(prisma.systemConfig.findUnique).toHaveBeenCalledWith({
        where: { key: CONFIG_KEY },
      });
    });

    it('returns null when no workstation config exists', async () => {
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getByWorkstation(SUBSCRIPTION_ID, WORKSTATION_ID);

      expect(result).toBeNull();
    });
  });

  // ── listBySubscription ────────────────────────────────────────────────

  describe('listBySubscription', () => {
    it('returns all workstation configs for the subscription', async () => {
      (prisma.systemConfig.findMany as jest.Mock).mockResolvedValue([mockSystemConfigRow]);

      const result = await service.listBySubscription(SUBSCRIPTION_ID);

      expect(result).toHaveLength(1);
      expect(result[0].workstationId).toBe(WORKSTATION_ID);
      expect(prisma.systemConfig.findMany).toHaveBeenCalledWith({
        where: { key: { startsWith: `ws_config:${SUBSCRIPTION_ID}:` } },
        orderBy: { updatedAt: 'desc' },
      });
    });

    it('returns empty array when no workstation configs exist', async () => {
      (prisma.systemConfig.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listBySubscription(SUBSCRIPTION_ID);

      expect(result).toEqual([]);
    });
  });

  // ── upsert ────────────────────────────────────────────────────────────

  describe('upsert', () => {
    const upsertData = {
      workflow: { autoPrintOnConfirm: false, printDuplicateReceipt: true },
      strictness: { cashShiftRequired: false, receiptPrintRequired: 'OPTIONAL' as const },
    };

    it('creates a new workstation config when none exists', async () => {
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.systemConfig.create as jest.Mock).mockResolvedValue(mockSystemConfigRow);

      const result = await service.upsert(SUBSCRIPTION_ID, WORKSTATION_ID, upsertData);

      expect(result.workstationId).toBe(WORKSTATION_ID);
      expect(prisma.systemConfig.create).toHaveBeenCalled();
      expect(prisma.systemConfig.update).not.toHaveBeenCalled();
    });

    it('updates existing workstation config', async () => {
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(mockSystemConfigRow);
      const updatedRow = {
        ...mockSystemConfigRow,
        value: {
          ...mockSystemConfigRow.value,
          workflow: { autoPrintOnConfirm: true, printDuplicateReceipt: false },
        },
      };
      (prisma.systemConfig.update as jest.Mock).mockResolvedValue(updatedRow);

      const result = await service.upsert(SUBSCRIPTION_ID, WORKSTATION_ID, {
        workflow: { autoPrintOnConfirm: true, printDuplicateReceipt: false },
      });

      expect(result.workflow.autoPrintOnConfirm).toBe(true);
      expect(prisma.systemConfig.update).toHaveBeenCalled();
      expect(prisma.systemConfig.create).not.toHaveBeenCalled();
    });

    it('filters out system-level strictness fields', async () => {
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.systemConfig.create as jest.Mock).mockResolvedValue(mockSystemConfigRow);

      await service.upsert(SUBSCRIPTION_ID, WORKSTATION_ID, {
        strictness: {
          cashShiftRequired: false,
          // System fields should be silently ignored
          lots: 'OFF' as any,
          expiryDates: 'OFF' as any,
          prescriptionEnforcement: 'OFF' as any,
        },
      });

      // Verify that the create call only contains allowed fields
      const createCall = (prisma.systemConfig.create as jest.Mock).mock.calls[0][0];
      const storedStrictness = createCall.data.value.strictness;
      expect(storedStrictness.lots).toBeUndefined();
      expect(storedStrictness.expiryDates).toBeUndefined();
      expect(storedStrictness.prescriptionEnforcement).toBeUndefined();
      expect(storedStrictness.cashShiftRequired).toBe(false);
    });
  });

  // ── delete ────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes existing workstation config', async () => {
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(mockSystemConfigRow);

      await service.delete(SUBSCRIPTION_ID, WORKSTATION_ID);

      expect(prisma.systemConfig.delete).toHaveBeenCalledWith({
        where: { key: CONFIG_KEY },
      });
    });

    it('throws NotFoundException when workstation config does not exist', async () => {
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.delete(SUBSCRIPTION_ID, WORKSTATION_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Validation helpers ────────────────────────────────────────────────

  describe('isWorkstationStrictnessField', () => {
    it('returns true for allowed fields', () => {
      expect(service.isWorkstationStrictnessField('cashShiftRequired')).toBe(true);
      expect(service.isWorkstationStrictnessField('receiptPrintRequired')).toBe(true);
      expect(service.isWorkstationStrictnessField('autoOpenDrawer')).toBe(true);
    });

    it('returns false for system-level fields', () => {
      expect(service.isWorkstationStrictnessField('lots')).toBe(false);
      expect(service.isWorkstationStrictnessField('expiryDates')).toBe(false);
      expect(service.isWorkstationStrictnessField('prescriptionEnforcement')).toBe(false);
    });
  });

  describe('isWorkstationWorkflowField', () => {
    it('returns true for workflow fields', () => {
      expect(service.isWorkstationWorkflowField('autoPrintOnConfirm')).toBe(true);
      expect(service.isWorkstationWorkflowField('sessionIdleTimeoutSeconds')).toBe(true);
    });
  });
});
