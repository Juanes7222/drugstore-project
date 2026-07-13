/**
 * Tests for formatCurrency.
 *
 * The function relies on Intl.NumberFormat with the es-CO locale which
 * the jsdom runtime (V8/ICU) provides.  The es-CO locale places a
 * non-breaking space (\u00a0) between the currency symbol and the
 * amount.  All assertions account for that character.
 */
import { describe, expect, it } from "vitest";
import { formatCurrency } from "./format-currency";

const NBSP = "\u00a0";

describe("formatCurrency", () => {
  it('formats zero as "$ followed by 0"', () => {
    const result = formatCurrency(0);

    expect(result).toContain("0");
    expect(result).toContain("$");
  });

  it("formats exact pesos with thousands separator", () => {
    // 500000 COP = 500.000 (with '.' as thousands separator)
    expect(formatCurrency(500000)).toBe(`$${NBSP}500.000`);
  });

  it("rounds cents to the nearest integer peso", () => {
    // maximumFractionDigits: 0, so 500050 → "500.050" (the '.' is thousands, not decimal)
    const result = formatCurrency(500050);

    expect(result).toBe(`$${NBSP}500.050`);
  });

  it("formats negative values with a minus sign", () => {
    expect(formatCurrency(-100000)).toBe(`-$${NBSP}100.000`);
  });

  it("formats large values with multiple separators", () => {
    expect(formatCurrency(150000000)).toBe(`$${NBSP}150.000.000`);
  });

  it("uses es-CO locale without decimal fraction digits", () => {
    const result = formatCurrency(123456);

    // Must contain the peso sign followed by NBSP, digits, and '.' separators
    expect(result).toMatch(new RegExp(`^\\$${NBSP}\\d{1,3}(\\.\\d{3})*$`));
    expect(result).not.toContain(",");
  });
});
