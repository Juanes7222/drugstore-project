/**
 * Tests for formatShortDate.
 *
 * The function uses i18n.language which is initialised to "es" by the
 * vitest.setup.ts import of @/i18n, so the expected short format follows
 * Spanish locale conventions (dd/mm/yy).
 */
import { describe, expect, it } from "vitest";
import { formatShortDate } from "./format-date";

describe("formatShortDate", () => {
  it("formats a valid ISO date string as a short localized date", () => {
    const result = formatShortDate("2026-07-09T10:30:00.000Z");

    // es locale short format: dd/mm/yy
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{2}$/);
  });

  it("formats a past date correctly", () => {
    const result = formatShortDate("2025-01-15");

    // Should still produce a valid short date
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{2}$/);
  });

  it("returns the original string when the date is invalid", () => {
    const result = formatShortDate("not-a-date");

    expect(result).toBe("not-a-date");
  });

  it("returns the original string for empty input", () => {
    const result = formatShortDate("");

    expect(result).toBe("");
  });
});
