/**
 * Report execution service — CASH_SHIFT_CLOSE empty-shiftId guard.
 *
 * The report catalog ships `{ shiftId: '' }` as the CASH_SHIFT_CLOSE
 * default; the Zod schema would reject that sentinel as a generic
 * invalid-filters failure.  The service must surface it as
 * `ReportFiltersNotReadyException` instead, so the UI can prompt for
 * the shift rather than rendering an error state.  Other report codes
 * must never hit the guard.
 */
import { describe, expect, it, vi } from 'vitest';
import { RoleType } from '@pharmacy/shared-types';
import type { PrismaClient } from '@pharmacy/database/local';
import { ReportExecutionService } from './report-execution.service';
import {
  ReportExecutionException,
  ReportFiltersNotReadyException,
  ReportShiftNotFoundException,
} from './exceptions';
import { ReportCode } from './report-types';
import type { LocalSession } from '../auth/local-session.store';

const DEFAULT_MESSAGE_KEY = 'reports.filters.select_shift';

const baseSession: LocalSession = {
  userId: 'user-1',
  username: 'manager',
  fullName: 'Manager User',
  displayName: 'Manager',
  role: RoleType.MANAGER,
  subscriptionId: 'sub-1',
  workstationId: 'ws-1',
  accessToken: '',
  refreshToken: '',
  sessionId: 'session-1',
  sessionTrust: 'SERVER_VERIFIED',
};

// All guard tests fail before any database access; the $queryRawUnsafe
// stub only serves the tests that pass the guard and reach the query
// pipeline (empty result set → ReportShiftNotFoundException).
const createService = (): ReportExecutionService => {
  const prisma = {
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  } as unknown as PrismaClient;
  return new ReportExecutionService(prisma);
};

describe('ReportExecutionService', () => {
  describe('run with CASH_SHIFT_CLOSE', () => {
    it('rejects with the default not-ready exception when filters are undefined', async () => {
      const service = createService();

      await expect(
        service.run({ code: ReportCode.CASH_SHIFT_CLOSE, filters: undefined, session: baseSession }),
      ).rejects.toMatchObject({
        errorCode: 'REPORT_FILTERS_NOT_READY',
        messageKey: DEFAULT_MESSAGE_KEY,
      });
    });

    it('rejects with the default not-ready exception when shiftId is missing', async () => {
      const service = createService();

      await expect(
        service.run({ code: ReportCode.CASH_SHIFT_CLOSE, filters: {}, session: baseSession }),
      ).rejects.toMatchObject({
        errorCode: 'REPORT_FILTERS_NOT_READY',
        messageKey: DEFAULT_MESSAGE_KEY,
      });
    });

    it('rejects with the default not-ready exception when shiftId is an empty string', async () => {
      const service = createService();

      await expect(
        service.run({ code: ReportCode.CASH_SHIFT_CLOSE, filters: { shiftId: '' }, session: baseSession }),
      ).rejects.toMatchObject({
        errorCode: 'REPORT_FILTERS_NOT_READY',
        messageKey: DEFAULT_MESSAGE_KEY,
      });
    });

    it('rejects with the default not-ready exception when shiftId is whitespace-only', async () => {
      const service = createService();

      await expect(
        service.run({ code: ReportCode.CASH_SHIFT_CLOSE, filters: { shiftId: '   ' }, session: baseSession }),
      ).rejects.toMatchObject({
        errorCode: 'REPORT_FILTERS_NOT_READY',
        messageKey: DEFAULT_MESSAGE_KEY,
      });
    });

    it('is not an instance of ReportExecutionException', async () => {
      const service = createService();

      const promise = service.run({
        code: ReportCode.CASH_SHIFT_CLOSE,
        filters: { shiftId: '' },
        session: baseSession,
      });
      await expect(promise).rejects.toBeInstanceOf(ReportFiltersNotReadyException);
      await expect(promise).rejects.not.toBeInstanceOf(ReportExecutionException);
    });

    it('passes the guard for a non-blank shiftId and fails downstream when the shift does not exist', async () => {
      const service = createService();

      await expect(
        service.run({ code: ReportCode.CASH_SHIFT_CLOSE, filters: { shiftId: 'shift-1' }, session: baseSession }),
      ).rejects.toBeInstanceOf(ReportShiftNotFoundException);
    });
  });

  describe('run with other report codes', () => {
    it('never applies the guard when filters are invalid', async () => {
      const service = createService();

      await expect(
        service.run({ code: ReportCode.SALES_DAILY_SUMMARY, filters: {}, session: baseSession }),
      ).rejects.toBeInstanceOf(ReportExecutionException);
    });
  });
});
