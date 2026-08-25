import { createPrismaDatabaseMock } from '../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { Prisma, PrismaClient } from '@pharmacy/database';
import {
  TelemetryService,
  TELEMETRY_INGEST_STATUS,
} from './telemetry.service';
import { SignatureService } from './signature.service';
import { InvalidSignatureException } from './exceptions/invalid-signature.exception';
import { UpdateOutcome } from '@pharmacy/shared-types';
import type { UpdateTelemetryInput } from './dto';

const OCCURRED_AT = '2026-08-25T10:00:00.000Z';

const buildEvent = (
  overrides: Partial<UpdateTelemetryInput> = {},
): UpdateTelemetryInput => ({
  workstationId: 'ws-1',
  licenseId: 'lic-1',
  fromVersion: '1.0.0',
  toVersion: '1.1.0',
  attemptId: 'attempt-1',
  outcome: UpdateOutcome.INSTALL_COMPLETED,
  occurredAt: OCCURRED_AT,
  signature: 'sig',
  ...overrides,
});

describe('TelemetryService', () => {
  let service: TelemetryService;
  let prisma: DeepMockProxy<PrismaClient>;
  let signatureService: { verifyTelemetrySignature: jest.Mock };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    signatureService = {
      verifyTelemetrySignature: jest.fn().mockReturnValue(true),
    };
    service = new TelemetryService(
      prisma as any,
      signatureService as unknown as SignatureService,
    );
  });

  describe('ingestTelemetry', () => {
    it('persists a signature-valid event under its resolved version id', async () => {
      const event = buildEvent();
      (prisma.updateVersion.findFirst as jest.Mock).mockResolvedValue({
        id: 'ver-1',
      });
      (prisma.updateAttemptLog.create as jest.Mock).mockResolvedValue({
        id: event.attemptId,
      });

      await service.ingestTelemetry(event);

      expect(signatureService.verifyTelemetrySignature).toHaveBeenCalledWith(
        [
          'ws-1',
          'lic-1',
          '1.0.0',
          '1.1.0',
          'attempt-1',
          UpdateOutcome.INSTALL_COMPLETED,
          OCCURRED_AT,
        ].join('|'),
        'sig',
        'lic-1',
      );
      expect(prisma.updateVersion.findFirst).toHaveBeenCalledWith({
        where: { version: '1.1.0' },
        orderBy: { releaseDate: 'desc' },
        select: { id: true },
      });
      expect(prisma.updateAttemptLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'attempt-1',
          versionId: 'ver-1',
          workstationId: 'ws-1',
          licenseId: 'lic-1',
          fromVersion: '1.0.0',
          toVersion: '1.1.0',
          outcome: UpdateOutcome.INSTALL_COMPLETED,
          occurredAt: new Date(OCCURRED_AT),
        }),
      });
    });

    it('counts a created event in the aggregates as a success outcome', async () => {
      (prisma.updateVersion.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.updateAttemptLog.create as jest.Mock).mockResolvedValue({
        id: 'attempt-1',
      });

      await service.ingestTelemetry(
        buildEvent({ outcome: UpdateOutcome.RESTARTED_OK }),
      );

      const aggregates = service.getAggregates();
      expect(aggregates.totalAttempts).toBe(1);
      expect(aggregates.successCount).toBe(1);
      expect(aggregates.byOutcome.get(UpdateOutcome.RESTARTED_OK)).toBe(1);
    });

    it('skips the version lookup and files the attempt under __unknown__ when toVersion is absent', async () => {
      const event = buildEvent({ toVersion: undefined });
      (prisma.updateAttemptLog.create as jest.Mock).mockResolvedValue({
        id: 'attempt-1',
      });

      await service.ingestTelemetry(event);

      expect(prisma.updateVersion.findFirst).not.toHaveBeenCalled();
      expect(prisma.updateAttemptLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          versionId: '__unknown__',
          toVersion: null,
        }),
      });
    });

    it('signs an empty string in the toVersion slot when the field is absent', async () => {
      (prisma.updateAttemptLog.create as jest.Mock).mockResolvedValue({
        id: 'attempt-1',
      });

      await service.ingestTelemetry(
        buildEvent({
          toVersion: undefined,
          outcome: UpdateOutcome.CHECK_NO_UPDATE,
        }),
      );

      expect(signatureService.verifyTelemetrySignature).toHaveBeenCalledWith(
        [
          'ws-1',
          'lic-1',
          '1.0.0',
          '',
          'attempt-1',
          UpdateOutcome.CHECK_NO_UPDATE,
          OCCURRED_AT,
        ].join('|'),
        'sig',
        'lic-1',
      );
    });

    it('throws InvalidSignatureException without persisting or counting when the signature does not verify', async () => {
      signatureService.verifyTelemetrySignature.mockReturnValue(false);

      await expect(service.ingestTelemetry(buildEvent())).rejects.toThrow(
        InvalidSignatureException,
      );

      expect(prisma.updateAttemptLog.create).not.toHaveBeenCalled();
      expect(service.getAggregates().totalAttempts).toBe(0);
    });

    it('returns the existing row on P2002 without counting aggregates again', async () => {
      const existingRow = { id: 'attempt-1' };
      (prisma.updateVersion.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.updateAttemptLog.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`id`)',
          { code: 'P2002', clientVersion: 'test-client-version' },
        ),
      );
      (prisma.updateAttemptLog.findUnique as jest.Mock).mockResolvedValue(
        existingRow,
      );

      const result = await service.ingestTelemetry(buildEvent());

      expect(prisma.updateAttemptLog.findUnique).toHaveBeenCalledWith({
        where: { id: 'attempt-1' },
      });
      expect(result).toBe(existingRow);
      const aggregates = service.getAggregates();
      expect(aggregates.totalAttempts).toBe(0);
      expect(aggregates.byOutcome.size).toBe(0);
    });

    it('rethrows a non-P2002 persistence error instead of treating it as a replay', async () => {
      (prisma.updateVersion.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.updateAttemptLog.create as jest.Mock).mockRejectedValue(
        new Error('connection reset'),
      );

      await expect(service.ingestTelemetry(buildEvent())).rejects.toThrow(
        'connection reset',
      );

      expect(prisma.updateAttemptLog.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('ingestTelemetryBatch', () => {
    it('isolates a poisoned event as INVALID_SIGNATURE while accepting the rest of the flush', async () => {
      (prisma.updateVersion.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.updateAttemptLog.create as jest.Mock).mockResolvedValue({
        id: 'ok',
      });
      // Call order follows the array order: verify is synchronous per event.
      signatureService.verifyTelemetrySignature
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      const results = await service.ingestTelemetryBatch([
        buildEvent({ attemptId: 'attempt-ok' }),
        buildEvent({ attemptId: 'attempt-bad', signature: 'tampered' }),
      ]);

      expect(results).toEqual([
        {
          attemptId: 'attempt-ok',
          status: TELEMETRY_INGEST_STATUS.ACCEPTED,
        },
        {
          attemptId: 'attempt-bad',
          status: TELEMETRY_INGEST_STATUS.INVALID_SIGNATURE,
        },
      ]);
      expect(prisma.updateAttemptLog.create).toHaveBeenCalledTimes(1);
    });

    it('propagates a transient persistence error so the client retries the whole flush', async () => {
      (prisma.updateVersion.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.updateAttemptLog.create as jest.Mock).mockRejectedValue(
        new Error('db unavailable'),
      );

      await expect(
        service.ingestTelemetryBatch([
          buildEvent({ attemptId: 'attempt-a' }),
          buildEvent({ attemptId: 'attempt-b' }),
        ]),
      ).rejects.toThrow('db unavailable');
    });

    it('does not swallow a transient error even when another event in the batch has an invalid signature', async () => {
      (prisma.updateVersion.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.updateAttemptLog.create as jest.Mock).mockImplementation(
        async ({ data }) => {
          if (data.id === 'attempt-flaky') {
            throw new Error('db unavailable');
          }
          return { id: data.id };
        },
      );
      signatureService.verifyTelemetrySignature
        .mockReturnValueOnce(true) // attempt-good: accepted
        .mockReturnValueOnce(false) // attempt-bad: poisoned, reported
        .mockReturnValueOnce(true); // attempt-flaky: transient failure

      await expect(
        service.ingestTelemetryBatch([
          buildEvent({ attemptId: 'attempt-good' }),
          buildEvent({ attemptId: 'attempt-bad', signature: 'tampered' }),
          buildEvent({ attemptId: 'attempt-flaky' }),
        ]),
      ).rejects.toThrow('db unavailable');
    });

    it('reports ACCEPTED for a replayed attemptId and keeps aggregate counters stable', async () => {
      const storedRow = { id: 'attempt-1' };
      (prisma.updateVersion.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.updateAttemptLog.create as jest.Mock)
        .mockResolvedValueOnce(storedRow)
        .mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError(
            'Unique constraint failed on the fields: (`id`)',
            { code: 'P2002', clientVersion: 'test-client-version' },
          ),
        );
      (prisma.updateAttemptLog.findUnique as jest.Mock).mockResolvedValue(
        storedRow,
      );

      await service.ingestTelemetry(buildEvent());

      const results = await service.ingestTelemetryBatch([buildEvent()]);

      expect(results).toEqual([
        {
          attemptId: 'attempt-1',
          status: TELEMETRY_INGEST_STATUS.ACCEPTED,
        },
      ]);
      expect(service.getAggregates().totalAttempts).toBe(1);
    });
  });
});
