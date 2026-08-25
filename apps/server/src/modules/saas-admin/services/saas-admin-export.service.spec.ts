import { jest, describe, it, expect } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { SaasAdminExportService } from './saas-admin-export.service';
import type { SaasAdminCustomerRow } from './saas-admin-overview.service';
import type { SaasAdminAtRiskRow } from './saas-admin-at-risk.service';
import type { User } from '@pharmacy/shared-types';
import { CsvBuilderService } from '@/modules/backoffice/services/csv-builder.service';

const ACTOR = {
  id: 'admin-1',
  role: 'SAAS_ADMIN',
} as unknown as User;

function buildCustomerRow(
  overrides: Partial<SaasAdminCustomerRow> = {},
): SaasAdminCustomerRow {
  return {
    id: 'sub-1',
    customerName: 'Farmacia Central',
    customerTaxId: '900123456-1',
    customerEmail: 'owner@central.com',
    status: 'ACTIVE',
    plan: { code: 'PRO', name: 'Plan Pro' },
    currentPeriodStart: '2026-08-01T00:00:00.000Z',
    currentPeriodEnd: '2026-08-31T23:59:59.000Z',
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    _count: {
      locations: 2,
      workstationActivations: 3,
      fraudAlerts: 0,
    },
    lastActivityAt: '2026-08-20T10:30:00.000Z',
    ...overrides,
  };
}

describe('SaasAdminExportService', () => {
  let prisma: MockProxy<PrismaClient>;
  let overview: { getCustomerRowsForExport: jest.Mock };
  let atRisk: { getAtRiskCustomers: jest.Mock };
  let accessAudit: { recordExportAccess: jest.Mock };
  let service: SaasAdminExportService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    overview = { getCustomerRowsForExport: jest.fn().mockResolvedValue([]) };
    atRisk = { getAtRiskCustomers: jest.fn().mockResolvedValue([]) };
    accessAudit = { recordExportAccess: jest.fn().mockResolvedValue(undefined) };
    service = new SaasAdminExportService(
      overview as never,
      atRisk as never,
      accessAudit as never,
      new CsvBuilderService(),
    );
  });

  describe('getCustomersCsv', () => {
    it('writes the exact column contract and maps a full row', async () => {
      overview.getCustomerRowsForExport.mockResolvedValue([
        buildCustomerRow(),
      ]);

      const csv = await service.getCustomersCsv(ACTOR, undefined, null);

      const lines = csv.split('\r\n');
      // BOM prefixes the header line; trailing CRLF leaves a final empty piece.
      expect(lines[0]).toBe('\uFEFFcustomerName,customerTaxId,customerEmail,status,planCode,planName,currentPeriodStart,currentPeriodEnd,trialEndsAt,cancelAtPeriodEnd,locations,workstationActivations,fraudAlerts,lastActivityAt');
      expect(lines[1]).toBe(
        [
          'Farmacia Central',
          '900123456-1',
          'owner@central.com',
          'ACTIVE',
          'PRO',
          'Plan Pro',
          '2026-08-01 00:00',
          '2026-08-31 23:59',
          '', // trialEndsAt null -> empty cell
          'false',
          '2',
          '3',
          '0',
          '2026-08-20 10:30',
        ].join(','),
      );
    });

    it('maps null email and lastActivityAt to empty cells and booleans to true/false', async () => {
      overview.getCustomerRowsForExport.mockResolvedValue([
        buildCustomerRow({
          customerEmail: null,
          lastActivityAt: null,
          cancelAtPeriodEnd: true,
        }),
      ]);

      const csv = await service.getCustomersCsv(ACTOR);

      const [, dataLine] = csv.split('\r\n');
      const cells = dataLine?.split(',') ?? [];
      expect(cells[2]).toBe('');
      expect(cells[9]).toBe('true');
      expect(cells[13]).toBe('');
    });

    it('renders count fields as plain integer strings, not decimals', async () => {
      overview.getCustomerRowsForExport.mockResolvedValue([
        buildCustomerRow({
          _count: { locations: 12, workstationActivations: 340, fraudAlerts: 7 },
        }),
      ]);

      const csv = await service.getCustomersCsv(ACTOR);
      const [, dataLine] = csv.split('\r\n');
      expect(dataLine).toContain(',12,340,7,');
      expect(dataLine).not.toMatch(/\d\.\d+/);
    });

    it('RFC4180-escapes names containing commas and quotes', async () => {
      overview.getCustomerRowsForExport.mockResolvedValue([
        buildCustomerRow({ customerName: 'Farmacia "Central", S.A.S' }),
      ]);

      const csv = await service.getCustomersCsv(ACTOR);
      const [, dataLine] = csv.split('\r\n');
      expect(dataLine?.startsWith('"Farmacia ""Central"", S.A.S",')).toBe(true);
    });

    it('passes the filter through, audits once, and stamps the file name YYYYMMDD', async () => {
      overview.getCustomerRowsForExport.mockResolvedValue([
        buildCustomerRow(),
        buildCustomerRow({ id: 'sub-2' }),
      ]);

      await service.getCustomersCsv(ACTOR, 'central', '10.0.0.1');

      expect(overview.getCustomerRowsForExport).toHaveBeenCalledWith('central');
      expect(accessAudit.recordExportAccess).toHaveBeenCalledTimes(1);
      expect(accessAudit.recordExportAccess).toHaveBeenCalledWith({
        actorUser: { id: ACTOR.id, role: ACTOR.role },
        endpoint: '/saas-admin/customers/export',
        fileName: expect.stringMatching(/^saas-customers-\d{8}\.csv$/),
        rowCount: 2,
        ipAddress: '10.0.0.1',
      });
    });
  });

  describe('getAtRiskCsv', () => {
    it('writes the exact columns, keeps never-sold lastSaleAt empty, and stamps inactiveDays on every row', async () => {
      atRisk.getAtRiskCustomers.mockResolvedValue([
        {
          subscriptionId: 'sub-a',
          customerName: 'Drogueria Norte',
          customerEmail: null,
          status: 'TRIAL',
          lastSaleAt: null,
          workstationActivations: 0,
        } satisfies SaasAdminAtRiskRow,
        {
          subscriptionId: 'sub-b',
          customerName: 'Farmacia Sur',
          customerEmail: 'sur@pharma.com',
          status: 'ACTIVE',
          lastSaleAt: '2026-06-01T08:05:00.000Z',
          workstationActivations: 4,
        } satisfies SaasAdminAtRiskRow,
      ]);

      const csv = await service.getAtRiskCsv(ACTOR, 30, null);

      const lines = csv.split('\r\n');
      expect(lines[0]).toBe(
        '\uFEFFcustomerName,customerEmail,status,lastSaleAt,inactiveDays,workstationActivations',
      );
      expect(lines[1]).toBe('Drogueria Norte,,TRIAL,,30,0');
      expect(lines[2]).toBe('Farmacia Sur,sur@pharma.com,ACTIVE,2026-06-01 08:05,30,4');
      expect(atRisk.getAtRiskCustomers).toHaveBeenCalledWith(30);
    });

    it('audits the export with the at-risk endpoint descriptor', async () => {
      atRisk.getAtRiskCustomers.mockResolvedValue([]);

      await service.getAtRiskCsv(ACTOR, 14, '10.0.0.2');

      expect(accessAudit.recordExportAccess).toHaveBeenCalledWith({
        actorUser: { id: ACTOR.id, role: ACTOR.role },
        endpoint: '/saas-admin/at-risk/export',
        fileName: expect.stringMatching(/^saas-at-risk-\d{8}\.csv$/),
        rowCount: 0,
        ipAddress: '10.0.0.2',
      });
    });
  });
});
