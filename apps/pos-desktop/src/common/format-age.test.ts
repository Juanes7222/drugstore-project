/**
 * Unit tests for formatAge.
 *
 * Covers: current timestamp, past intervals, future dates, empty string.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { formatAge } from './format-age';

describe('formatAge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for the current timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T12:00:00.000Z'));

    const now = new Date('2026-07-14T12:00:00.000Z').toISOString();
    expect(formatAge(now)).toBe('just now');
  });

  it('returns "just now" for a timestamp less than 1 minute ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T12:00:00.000Z'));

    const thirtySecondsAgo = new Date('2026-07-14T11:59:30.000Z').toISOString();
    expect(formatAge(thirtySecondsAgo)).toBe('just now');
  });

  it('returns "5m ago" for a timestamp 5 minutes ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T12:00:00.000Z'));

    const fiveMinAgo = new Date('2026-07-14T11:55:00.000Z').toISOString();
    expect(formatAge(fiveMinAgo)).toBe('5m ago');
  });

  it('returns "2h ago" for a timestamp 2 hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T12:00:00.000Z'));

    const twoHoursAgo = new Date('2026-07-14T10:00:00.000Z').toISOString();
    expect(formatAge(twoHoursAgo)).toBe('2h ago');
  });

  it('returns "3d ago" for a timestamp 3 days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T12:00:00.000Z'));

    const threeDaysAgo = new Date('2026-07-11T12:00:00.000Z').toISOString();
    expect(formatAge(threeDaysAgo)).toBe('3d ago');
  });

  it('returns "just now" for a future date (negative diff becomes < 1 min)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T12:00:00.000Z'));

    const futureDate = new Date('2026-07-15T12:00:00.000Z').toISOString();
    expect(formatAge(futureDate)).toBe('just now');
  });

  it('returns "NaNd ago" for an empty string (NaN diff)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T12:00:00.000Z'));

    const result = formatAge('');
    expect(result).toContain('NaN');
    // The function does not guard against invalid dates;
    // this test documents the current behaviour.
  });
});
