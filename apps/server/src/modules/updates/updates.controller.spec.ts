import { createPrismaDatabaseMock } from '../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { Test, TestingModule } from '@nestjs/testing';
import { UpdatesController } from './updates.controller';
import { UpdatesService } from './updates.service';
import { TelemetryService, TELEMETRY_INGEST_STATUS } from './telemetry.service';

const buildTelemetryBody = (overrides: Record<string, unknown> = {}) => ({
  workstationId: 'ws-1',
  licenseId: 'lic-1',
  fromVersion: '1.0.0',
  toVersion: '1.1.0',
  attemptId: 'attempt-1',
  outcome: 'CHECK_OK',
  occurredAt: '2026-08-25T10:00:00.000Z',
  signature: 'a'.repeat(64),
  ...overrides,
});

const mockUpdatesService = {
  checkForUpdate: jest.fn(),
};

const mockTelemetryService = {
  ingestTelemetry: jest.fn(),
  ingestTelemetryBatch: jest.fn(),
};

describe('UpdatesController', () => {
  let controller: UpdatesController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UpdatesController],
      providers: [
        { provide: UpdatesService, useValue: mockUpdatesService },
        { provide: TelemetryService, useValue: mockTelemetryService },
      ],
    }).compile();

    controller = module.get<UpdatesController>(UpdatesController);
  });

  describe('POST /updates/telemetry', () => {
    it('delegates a single event to ingestTelemetry and answers accepted', async () => {
      const body = buildTelemetryBody();
      mockTelemetryService.ingestTelemetry.mockResolvedValue({
        id: 'attempt-1',
      });

      const result = await controller.telemetry(body as any);

      expect(mockTelemetryService.ingestTelemetry).toHaveBeenCalledWith(body);
      expect(mockTelemetryService.ingestTelemetryBatch).not.toHaveBeenCalled();
      expect(result).toEqual({ accepted: true });
    });

    it('delegates a batch envelope to ingestTelemetryBatch and returns per-event results', async () => {
      const events = [
        buildTelemetryBody({ attemptId: 'attempt-1' }),
        buildTelemetryBody({ attemptId: 'attempt-2' }),
      ];
      const batchResults = [
        { attemptId: 'attempt-1', status: TELEMETRY_INGEST_STATUS.ACCEPTED },
      ];
      mockTelemetryService.ingestTelemetryBatch.mockResolvedValue(batchResults);

      const result = await controller.telemetry({ events } as any);

      expect(mockTelemetryService.ingestTelemetryBatch).toHaveBeenCalledWith(
        events,
      );
      expect(mockTelemetryService.ingestTelemetry).not.toHaveBeenCalled();
      expect(result).toEqual({ accepted: true, results: batchResults });
    });
  });
});
