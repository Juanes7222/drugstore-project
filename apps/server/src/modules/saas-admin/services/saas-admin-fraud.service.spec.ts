import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import {
  SaasAdminFraudService,
  type SaasAdminFraudAlertRow,
} from './saas-admin-fraud.service';
import { FraudAlertNotFoundException } from '../exceptions/fraud-alert-not-found.exception';
import { FraudAlertAlreadyResolvedException } from '../exceptions/fraud-alert-already-resolved.exception';

type AlertFixture = {
  id: string;
  subscriptionId: string;
  subscription: { customerName: string };
  detectorName: string;
  severity: string;
  suggestedAction: string;
  reason: string;
  status: string;
  createdAt: Date;
  detectedAt: Date;
  resolvedAt: Date | null;
  resolvedById: string | null;
};

const ADMIN_ACTOR = { id: 'admin-1', role: 'SAAS_ADMIN' };

function buildFraudAlert(overrides: Partial<AlertFixture> = {}): AlertFixture {
  return {
    id: 'alert-1',
    subscriptionId: 'sub-1',
    subscription: { customerName: 'Farmacia Central' },
    detectorName: 'HardwareFingerprintCollisionDetector',
    severity: 'HIGH',
    suggestedAction: 'REVIEW_WORKSTATIONS',
    reason: 'Same hardware fingerprint on two activations',
    status: 'OPEN',
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    detectedAt: new Date('2026-08-01T10:00:00.000Z'),
    resolvedAt: null,
    resolvedById: null,
    ...overrides,
  };
}

describe('SaasAdminFraudService', () => {
  let prisma: MockProxy<PrismaClient>;
  let accessAudit: { recordCustomerAccess: jest.Mock };
  let service: SaasAdminFraudService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    accessAudit = {
      recordCustomerAccess: jest.fn<(input: unknown) => Promise<void>>(),
    };
    accessAudit.recordCustomerAccess.mockResolvedValue(undefined);
    service = new SaasAdminFraudService(prisma as never, accessAudit as never);

    prisma.fraudAlert.findMany.mockResolvedValue([]);
    prisma.fraudAlert.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);
  });

  describe('getFraudAlerts', () => {
    it('filters to unresolved alerts (resolvedAt null) when status is omitted', async () => {
      await service.getFraudAlerts({});

      expect(prisma.fraudAlert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { resolvedAt: null } }),
      );
      expect(prisma.fraudAlert.count).toHaveBeenCalledWith({
        where: { resolvedAt: null },
      });
    });

    it('disables filtering entirely when status is ALL', async () => {
      await service.getFraudAlerts({ status: 'ALL' });

      expect(prisma.fraudAlert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
      expect(prisma.fraudAlert.count).toHaveBeenCalledWith({ where: {} });
    });

    it('passes an explicit workflow status through without a resolution constraint', async () => {
      await service.getFraudAlerts({ status: 'DISMISSED' });

      const expectedWhere = { status: 'DISMISSED' };
      expect(prisma.fraudAlert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      // An explicitly resolved status must not be constrained to unresolved rows.
      expect(prisma.fraudAlert.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
    });

    it('orders by detectedAt descending and uses default pagination of page 1, pageSize 20', async () => {
      prisma.fraudAlert.count.mockResolvedValue(45);

      const result = await service.getFraudAlerts({});

      expect(prisma.fraudAlert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { detectedAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(3);
    });

    it('computes skip from page and pageSize', async () => {
      await service.getFraudAlerts({ page: 3, pageSize: 10 });

      expect(prisma.fraudAlert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('clamps pageSize above 100 down to 100 and page below 1 up to 1', async () => {
      await service.getFraudAlerts({ page: -5, pageSize: 250 });

      expect(prisma.fraudAlert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });

    it('maps alert columns to API row fields including nullable resolution data', async () => {
      const resolvedAt = new Date('2026-08-02T12:30:00.000Z');
      prisma.fraudAlert.findMany.mockResolvedValue([
        buildFraudAlert({
          id: 'alert-open',
          status: 'OPEN',
          resolvedAt: null,
          resolvedById: null,
        }),
        buildFraudAlert({
          id: 'alert-resolved',
          status: 'CONFIRMED_FRAUD',
          resolvedAt,
          resolvedById: 'admin-7',
        }),
      ] as never);
      prisma.user.findMany.mockResolvedValue([
        { id: 'admin-7', email: 'admin7@example.com' },
      ] as never);

      const result = await service.getFraudAlerts({});

      const open = result.data[0];
      const resolved = result.data[1] as SaasAdminFraudAlertRow;
      expect(open).toMatchObject({
        id: 'alert-open',
        subscriptionId: 'sub-1',
        customerName: 'Farmacia Central',
        type: 'HardwareFingerprintCollisionDetector',
        severity: 'HIGH',
        suggestedAction: 'REVIEW_WORKSTATIONS',
        description: 'Same hardware fingerprint on two activations',
        status: 'OPEN',
      });
      expect(open.resolvedAt).toBeNull();
      expect(open.resolvedByAdminEmail).toBeNull();
      expect(resolved.resolvedAt).toBe(resolvedAt.toISOString());
      expect(resolved.resolvedByAdminEmail).toBe('admin7@example.com');
    });

    it('resolves admin emails in one batched lookup for the page resolvers', async () => {
      prisma.fraudAlert.findMany.mockResolvedValue([
        buildFraudAlert({ id: 'a-1', resolvedById: 'admin-7' }),
        buildFraudAlert({ id: 'a-2', resolvedById: 'admin-7' }),
        buildFraudAlert({ id: 'a-3', resolvedById: 'admin-8' }),
      ] as never);
      prisma.user.findMany.mockResolvedValue([
        { id: 'admin-7', email: 'admin7@example.com' },
      ] as never);

      await service.getFraudAlerts({});

      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['admin-7', 'admin-8'] } },
        select: { id: true, email: true },
      });
    });

    it('maps an unknown resolver id to a null email without failing', async () => {
      prisma.fraudAlert.findMany.mockResolvedValue([
        buildFraudAlert({ resolvedById: 'gone-admin' }),
      ] as never);
      prisma.user.findMany.mockResolvedValue([] as never);

      const result = await service.getFraudAlerts({});

      expect(result.data[0]?.resolvedByAdminEmail).toBeNull();
    });
  });

  describe('resolveFraudAlert', () => {
    it('flips only unresolved alerts via a conditional updateMany and stamps the acting admin', async () => {
      prisma.fraudAlert.updateMany.mockResolvedValue({ count: 1 });
      prisma.fraudAlert.findUnique.mockResolvedValue(
        buildFraudAlert({
          id: 'alert-1',
          resolvedById: ADMIN_ACTOR.id,
          resolvedAt: new Date('2026-08-02T09:00:00.000Z'),
        }) as never,
      );

      await service.resolveFraudAlert(ADMIN_ACTOR, 'alert-1', 'Confirmed fraud');

      expect(prisma.fraudAlert.updateMany).toHaveBeenCalledWith({
        where: { id: 'alert-1', resolvedAt: null },
        data: {
          resolvedAt: expect.any(Date),
          resolvedById: ADMIN_ACTOR.id,
          resolutionNotes: 'Confirmed fraud',
        },
      });
      expect(prisma.fraudAlert.findUnique).toHaveBeenCalledWith({
        where: { id: 'alert-1' },
        include: { subscription: { select: { customerName: true } } },
      });
    });

    it('writes null resolutionNotes when no note is provided', async () => {
      prisma.fraudAlert.updateMany.mockResolvedValue({ count: 1 });
      prisma.fraudAlert.findUnique.mockResolvedValue(buildFraudAlert() as never);

      await service.resolveFraudAlert(ADMIN_ACTOR, 'alert-1');

      expect(prisma.fraudAlert.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ resolutionNotes: null }),
        }),
      );
    });

    it('returns the updated row mapped with customer name and resolver email', async () => {
      prisma.fraudAlert.updateMany.mockResolvedValue({ count: 1 });
      prisma.fraudAlert.findUnique.mockResolvedValue(
        buildFraudAlert({
          resolvedAt: new Date('2026-08-02T09:00:00.000Z'),
          resolvedById: ADMIN_ACTOR.id,
        }) as never,
      );
      prisma.user.findMany.mockResolvedValue([
        { id: ADMIN_ACTOR.id, email: 'platform@example.com' },
      ] as never);

      const row = await service.resolveFraudAlert(
        ADMIN_ACTOR,
        'alert-1',
        undefined,
      );

      expect(row.customerName).toBe('Farmacia Central');
      expect(row.resolvedByAdminEmail).toBe('platform@example.com');
      expect(row.resolvedAt).toBe('2026-08-02T09:00:00.000Z');
    });

    it('records an ACCESS audit entry for the resolved subscription', async () => {
      prisma.fraudAlert.updateMany.mockResolvedValue({ count: 1 });
      prisma.fraudAlert.findUnique.mockResolvedValue(buildFraudAlert() as never);

      await service.resolveFraudAlert(ADMIN_ACTOR, 'alert-1');

      expect(accessAudit.recordCustomerAccess).toHaveBeenCalledTimes(1);
      expect(accessAudit.recordCustomerAccess).toHaveBeenCalledWith({
        actorUser: ADMIN_ACTOR,
        subscriptionId: 'sub-1',
        endpoint: '/saas-admin/fraud-alerts/alert-1/resolve',
        // Controller without a request IP still produces a null-attributed row.
        ipAddress: null,
      });
    });

    it('attributes the caller request IP on the ACCESS audit entry when provided', async () => {
      prisma.fraudAlert.updateMany.mockResolvedValue({ count: 1 });
      prisma.fraudAlert.findUnique.mockResolvedValue(buildFraudAlert() as never);

      await service.resolveFraudAlert(
        ADMIN_ACTOR,
        'alert-1',
        undefined,
        '203.0.113.10',
      );

      expect(accessAudit.recordCustomerAccess).toHaveBeenCalledWith(
        expect.objectContaining({ ipAddress: '203.0.113.10' }),
      );
    });

    it('throws FraudAlertNotFoundException when the update matched no row and none exists', async () => {
      prisma.fraudAlert.updateMany.mockResolvedValue({ count: 0 });
      prisma.fraudAlert.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveFraudAlert(ADMIN_ACTOR, 'missing-alert'),
      ).rejects.toThrow(FraudAlertNotFoundException);
    });

    it('distinguishes 404 from 409: not-found carries NOT_FOUND and no row lookup difference', async () => {
      prisma.fraudAlert.updateMany.mockResolvedValue({ count: 0 });
      prisma.fraudAlert.findUnique.mockResolvedValue(null);

      const error = await service
        .resolveFraudAlert(ADMIN_ACTOR, 'missing-alert')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(FraudAlertNotFoundException);
      expect((error as FraudAlertNotFoundException).getStatus()).toBe(404);
    });

    it('throws FraudAlertAlreadyResolvedException when the update matched no row but the alert exists', async () => {
      prisma.fraudAlert.updateMany.mockResolvedValue({ count: 0 });
      prisma.fraudAlert.findUnique.mockResolvedValue({
        id: 'alert-1',
      } as never);

      const error = await service
        .resolveFraudAlert(ADMIN_ACTOR, 'alert-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(FraudAlertAlreadyResolvedException);
      expect((error as FraudAlertAlreadyResolvedException).getStatus()).toBe(
        409,
      );
    });

    it('does not write an audit entry when resolution loses the race or misses', async () => {
      prisma.fraudAlert.updateMany.mockResolvedValue({ count: 0 });
      prisma.fraudAlert.findUnique.mockResolvedValue({
        id: 'alert-1',
      } as never);

      await expect(
        service.resolveFraudAlert(ADMIN_ACTOR, 'alert-1'),
      ).rejects.toThrow(FraudAlertAlreadyResolvedException);

      expect(accessAudit.recordCustomerAccess).not.toHaveBeenCalled();
    });

    it('throws FraudAlertNotFoundException if the re-fetch after a successful flip finds nothing', async () => {
      // Guards the "concurrent hard deletion" branch documented in the service.
      prisma.fraudAlert.updateMany.mockResolvedValue({ count: 1 });
      prisma.fraudAlert.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveFraudAlert(ADMIN_ACTOR, 'alert-1'),
      ).rejects.toThrow(FraudAlertNotFoundException);
    });
  });
});
