import { ZodError } from 'zod';
import { UpdateOutcome } from '@pharmacy/shared-types';
import {
  UpdateTelemetrySchema,
  UpdateTelemetryBatchSchema,
  UpdateTelemetryRequestSchema,
  MAX_TELEMETRY_BATCH_SIZE,
  MAX_TELEMETRY_ERROR_MESSAGE_LENGTH,
} from './update-telemetry.schema';

const buildValidEvent = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  workstationId: 'ws-1',
  licenseId: 'lic-1',
  fromVersion: '1.0.0',
  toVersion: '1.1.0',
  attemptId: 'attempt-1',
  outcome: UpdateOutcome.CHECK_OK,
  occurredAt: '2026-08-25T10:00:00.000Z',
  signature: 'a'.repeat(64),
  ...overrides,
});

describe('UpdateTelemetrySchema', () => {
  it('parses a valid single event', () => {
    const event = buildValidEvent();

    const parsed = UpdateTelemetrySchema.parse(event);

    expect(parsed).toEqual(event);
  });

  describe('toVersion tolerance', () => {
    it('parses when toVersion is absent', () => {
      const { toVersion: _omitted, ...event } = buildValidEvent();

      const parsed = UpdateTelemetrySchema.parse(event);

      expect(parsed.toVersion).toBeUndefined();
    });

    it('parses an explicit undefined toVersion', () => {
      const parsed = UpdateTelemetrySchema.parse(
        buildValidEvent({ toVersion: undefined }),
      );

      expect(parsed.toVersion).toBeUndefined();
    });

    it('parses a null toVersion', () => {
      const parsed = UpdateTelemetrySchema.parse(
        buildValidEvent({ toVersion: null }),
      );

      expect(parsed.toVersion).toBeNull();
    });
  });

  describe('durationMs', () => {
    it('parses durationMs of 0 (cache-hit check within the same millisecond)', () => {
      const parsed = UpdateTelemetrySchema.parse(
        buildValidEvent({ durationMs: 0 }),
      );

      expect(parsed.durationMs).toBe(0);
    });

    it('rejects a negative durationMs', () => {
      expect(() =>
        UpdateTelemetrySchema.parse(buildValidEvent({ durationMs: -1 })),
      ).toThrow(ZodError);
    });

    it('rejects a fractional durationMs', () => {
      expect(() =>
        UpdateTelemetrySchema.parse(buildValidEvent({ durationMs: 1.5 })),
      ).toThrow(ZodError);
    });
  });

  describe('errorMessage bound', () => {
    it('accepts an errorMessage at the maximum length', () => {
      const parsed = UpdateTelemetrySchema.parse(
        buildValidEvent({
          errorMessage: 'x'.repeat(MAX_TELEMETRY_ERROR_MESSAGE_LENGTH),
        }),
      );

      expect(parsed.errorMessage).toHaveLength(MAX_TELEMETRY_ERROR_MESSAGE_LENGTH);
    });

    it('rejects an errorMessage over the maximum length', () => {
      expect(() =>
        UpdateTelemetrySchema.parse(
          buildValidEvent({
            errorMessage: 'x'.repeat(MAX_TELEMETRY_ERROR_MESSAGE_LENGTH + 1),
          }),
        ),
      ).toThrow(ZodError);
    });
  });
});

describe('UpdateTelemetryBatchSchema', () => {
  it('parses a batch envelope with two events', () => {
    const batch = {
      events: [
        buildValidEvent({ attemptId: 'attempt-1' }),
        buildValidEvent({ attemptId: 'attempt-2' }),
      ],
    };

    const parsed = UpdateTelemetryBatchSchema.parse(batch);

    expect(parsed.events).toHaveLength(2);
  });

  it('rejects an empty batch', () => {
    expect(() =>
      UpdateTelemetryBatchSchema.parse({ events: [] }),
    ).toThrow(ZodError);
  });

  it('rejects a batch over the maximum size', () => {
    const oversized = Array.from(
      { length: MAX_TELEMETRY_BATCH_SIZE + 1 },
      (_, i) => buildValidEvent({ attemptId: `attempt-${i}` }),
    );

    expect(() =>
      UpdateTelemetryBatchSchema.parse({ events: oversized }),
    ).toThrow(ZodError);
  });
});

describe('UpdateTelemetryRequestSchema', () => {
  it('accepts a bare single event through the union', () => {
    const event = buildValidEvent();

    const parsed = UpdateTelemetryRequestSchema.parse(event);

    expect('events' in parsed).toBe(false);
    expect(parsed).toEqual(event);
  });

  it('routes a batch envelope through the union as the batch shape', () => {
    const batch = {
      events: [
        buildValidEvent({ attemptId: 'attempt-1' }),
        buildValidEvent({ attemptId: 'attempt-2' }),
      ],
    };

    const parsed = UpdateTelemetryRequestSchema.parse(batch);

    expect('events' in parsed).toBe(true);
    if ('events' in parsed) {
      expect(parsed.events.map((e) => e.attemptId)).toEqual([
        'attempt-1',
        'attempt-2',
      ]);
    }
  });
});
