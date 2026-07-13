/**
 * Tests for the relative-time formatting utilities.
 *
 * Uses vi.useFakeTimers() to freeze Date.now() so the output is
 * deterministic regardless of when the test runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatBackupAge, formatRelativeTime } from "./time-format";

const NOW = new Date("2026-07-13T12:00:00.000Z").getTime();

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for timestamps less than 60 seconds ago', () => {
    expect(formatRelativeTime(new Date(NOW - 30_000).toISOString())).toBe("just now");
  });

  it("returns minutes ago for timestamps within the hour", () => {
    expect(formatRelativeTime(new Date(NOW - 5 * 60_000).toISOString())).toBe("5m ago");
  });

  it("returns hours ago for timestamps within the day", () => {
    expect(formatRelativeTime(new Date(NOW - 3 * 3600_000).toISOString())).toBe("3h ago");
  });

  it("returns days ago for timestamps within the week", () => {
    expect(formatRelativeTime(new Date(NOW - 2 * 86400_000).toISOString())).toBe("2d ago");
  });

  it("returns a locale-formatted date for timestamps older than 7 days", () => {
    const oldDate = new Date(NOW - 10 * 86400_000);
    const result = formatRelativeTime(oldDate.toISOString());

    expect(result).toBe(oldDate.toLocaleDateString());
  });
});

describe("formatBackupAge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for timestamps less than 1 minute ago', () => {
    expect(formatBackupAge(new Date(NOW - 30_000).toISOString())).toBe("just now");
  });

  it("returns minutes ago for timestamps less than an hour old", () => {
    expect(formatBackupAge(new Date(NOW - 15 * 60_000).toISOString())).toBe("15m ago");
  });

  it("returns hours ago for timestamps less than 24 hours old", () => {
    expect(formatBackupAge(new Date(NOW - 6 * 3600_000).toISOString())).toBe("6h ago");
  });

  it("returns days ago for timestamps older than 24 hours", () => {
    expect(formatBackupAge(new Date(NOW - 3 * 86400_000).toISOString())).toBe("3d ago");
  });
});
