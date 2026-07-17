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

  it("converts cents to pesos with thousands separator", () => {
    // 500000 cents = 5000 pesos → $ 5.000
    expect(formatCurrency(500000)).toBe(`$${NBSP}5.000`);
  });

  it("rounds fractional cents to the nearest integer peso", () => {
    // 500050 cents / 100 = 5000.5 → rounds to 5001
    const result = formatCurrency(500050);

    expect(result).toBe(`$${NBSP}5.001`);
  });

  it("formats negative values with a minus sign", () => {
    expect(formatCurrency(-100000)).toBe(`-$${NBSP}1.000`);
  });

  it("formats large values with multiple separators", () => {
    // 150000000 cents = 1,500,000 pesos
    expect(formatCurrency(150000000)).toBe(`$${NBSP}1.500.000`);
  });

  it("uses es-CO locale without decimal fraction digits", () => {
    // 123456 cents = 1234.56 → rounds to 1235 pesos
    const result = formatCurrency(123456);

    // Must contain the peso sign followed by NBSP, digits, and '.' separators
    expect(result).toMatch(new RegExp(`^\\$${NBSP}\\d{1,3}(\\.\\d{3})*$`));
    expect(result).not.toContain(",");
  });
});
