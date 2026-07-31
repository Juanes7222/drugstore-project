/**
 * Unit tests for sales-commission calculation — validity window and amount.
 */
import { describe, expect, it } from "vitest";
import { Prisma, CommissionType } from "@pharmacy/database/local";
import {
  calculateCommission,
  isCommissionWindowActive,
  type CommissionCalculationInput,
  type CommissionConfigInput,
} from "./commission";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

const makeConfig = (
  overrides?: Partial<CommissionConfigInput>,
): CommissionConfigInput => ({
  type: CommissionType.PERCENTAGE,
  value: new Prisma.Decimal(5),
  ...overrides,
});

const makeInput = (
  overrides?: Partial<CommissionCalculationInput>,
): CommissionCalculationInput => ({
  config: makeConfig(),
  unitPrice: new Prisma.Decimal(10000),
  quantity: 2,
  discountAmount: new Prisma.Decimal(2000),
  at: new Date("2026-07-16T10:00:00.000Z"),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isCommissionWindowActive", () => {
  const at = new Date("2026-07-16T10:00:00.000Z");

  it("returns true when no window bounds are set", () => {
    expect(isCommissionWindowActive(makeConfig(), at)).toBe(true);
  });

  it("returns true after the window start when only startsAt is set", () => {
    const config = makeConfig({ startsAt: "2026-07-16T09:00:00.000Z" });

    expect(isCommissionWindowActive(config, at)).toBe(true);
  });

  it("returns false before the window start when only startsAt is set", () => {
    const config = makeConfig({ startsAt: "2026-07-16T11:00:00.000Z" });

    expect(isCommissionWindowActive(config, at)).toBe(false);
  });

  it("returns true before the window end when only endsAt is set", () => {
    const config = makeConfig({ endsAt: "2026-07-16T11:00:00.000Z" });

    expect(isCommissionWindowActive(config, at)).toBe(true);
  });

  it("returns false after the window end when only endsAt is set", () => {
    const config = makeConfig({ endsAt: "2026-07-16T09:00:00.000Z" });

    expect(isCommissionWindowActive(config, at)).toBe(false);
  });

  it("returns true when at equals startsAt (boundary inclusive)", () => {
    const config = makeConfig({ startsAt: "2026-07-16T10:00:00.000Z" });

    expect(isCommissionWindowActive(config, at)).toBe(true);
  });

  it("returns true when at equals endsAt (boundary inclusive)", () => {
    const config = makeConfig({ endsAt: "2026-07-16T10:00:00.000Z" });

    expect(isCommissionWindowActive(config, at)).toBe(true);
  });

  it("returns false when a bound is an invalid date", () => {
    expect(isCommissionWindowActive(makeConfig({ startsAt: "not-a-date" }), at)).toBe(false);
    expect(isCommissionWindowActive(makeConfig({ endsAt: "not-a-date" }), at)).toBe(false);
  });
});

describe("calculateCommission", () => {
  it("returns no commission for NONE type even with a positive value", () => {
    const result = calculateCommission(
      makeInput({
        config: makeConfig({ type: CommissionType.NONE, value: new Prisma.Decimal(5) }),
      }),
    );

    expect(result.type).toBeNull();
    expect(result.value).toBeNull();
    expect(result.amount.toString()).toBe("0");
  });

  it("returns no commission when the config type is missing", () => {
    const result = calculateCommission(makeInput({ config: makeConfig({ type: undefined }) }));

    expect(result.type).toBeNull();
    expect(result.value).toBeNull();
    expect(result.amount.toString()).toBe("0");
  });

  it("computes the percentage on the post-discount base", () => {
    // unitPrice 10000 × qty 2 = 20000; discount 2000 (10 %) excluded from the
    // base → base 18000 × 5 % = 900. A base that ignored the discount would
    // yield 1000, so 900 proves the discount is excluded.
    const result = calculateCommission(makeInput());

    expect(result.type).toBe(CommissionType.PERCENTAGE);
    expect(result.value?.toString()).toBe("5");
    expect(result.amount.toString()).toBe("900");
  });

  it("computes the fixed commission per unit sold", () => {
    const result = calculateCommission(
      makeInput({
        config: makeConfig({ type: CommissionType.FIXED, value: new Prisma.Decimal(500) }),
        quantity: 3,
      }),
    );

    expect(result.type).toBe(CommissionType.FIXED);
    expect(result.value?.toString()).toBe("500");
    expect(result.amount.toString()).toBe("1500");
  });

  it("returns no commission when the value is zero", () => {
    const result = calculateCommission(
      makeInput({ config: makeConfig({ value: new Prisma.Decimal(0) }) }),
    );

    expect(result.type).toBeNull();
    expect(result.value).toBeNull();
    expect(result.amount.toString()).toBe("0");
  });

  it("returns no commission when the value is negative", () => {
    const result = calculateCommission(
      makeInput({ config: makeConfig({ value: new Prisma.Decimal(-5) }) }),
    );

    expect(result.type).toBeNull();
    expect(result.value).toBeNull();
    expect(result.amount.toString()).toBe("0");
  });

  it("returns no commission when the window has expired", () => {
    const result = calculateCommission(
      makeInput({ config: makeConfig({ endsAt: "2026-07-16T09:59:59.999Z" }) }),
    );

    expect(result.type).toBeNull();
    expect(result.value).toBeNull();
    expect(result.amount.toString()).toBe("0");
  });

  it("returns no commission when the window has not started yet", () => {
    const result = calculateCommission(
      makeInput({ config: makeConfig({ startsAt: "2026-07-16T10:00:00.001Z" }) }),
    );

    expect(result.type).toBeNull();
    expect(result.value).toBeNull();
    expect(result.amount.toString()).toBe("0");
  });

  it("computes commission when no window bounds are set", () => {
    const result = calculateCommission(
      makeInput({ config: makeConfig({ startsAt: null, endsAt: null }) }),
    );

    expect(result.type).toBe(CommissionType.PERCENTAGE);
    expect(result.amount.toString()).toBe("900");
  });

  it("computes commission at the exact startsAt instant (boundary inclusive)", () => {
    const result = calculateCommission(
      makeInput({
        config: makeConfig({ startsAt: "2026-07-16T10:00:00.000Z" }),
        at: new Date("2026-07-16T10:00:00.000Z"),
      }),
    );

    expect(result.type).toBe(CommissionType.PERCENTAGE);
    expect(result.amount.toString()).toBe("900");
  });

  it("computes commission at the exact endsAt instant (boundary inclusive)", () => {
    const result = calculateCommission(
      makeInput({
        config: makeConfig({ endsAt: "2026-07-16T10:00:00.000Z" }),
        at: new Date("2026-07-16T10:00:00.000Z"),
      }),
    );

    expect(result.type).toBe(CommissionType.PERCENTAGE);
    expect(result.amount.toString()).toBe("900");
  });

  it("returns no commission one millisecond after endsAt", () => {
    const result = calculateCommission(
      makeInput({
        config: makeConfig({ endsAt: "2026-07-16T10:00:00.000Z" }),
        at: new Date("2026-07-16T10:00:00.001Z"),
      }),
    );

    expect(result.type).toBeNull();
    expect(result.amount.toString()).toBe("0");
  });

  it("rounds percentage amounts half-up to cents", () => {
    // base 1 × 0.5 % = 0.005 → rounds half-up to 0.01, not 0.00.
    const result = calculateCommission(
      makeInput({
        config: makeConfig({ value: new Prisma.Decimal("0.5") }),
        unitPrice: new Prisma.Decimal(1),
        quantity: 1,
        discountAmount: new Prisma.Decimal(0),
      }),
    );

    expect(result.amount.toString()).toBe("0.01");
  });

  it("rounds fixed amounts half-up to cents", () => {
    const result = calculateCommission(
      makeInput({
        config: makeConfig({ type: CommissionType.FIXED, value: new Prisma.Decimal("0.005") }),
        quantity: 1,
      }),
    );

    expect(result.amount.toString()).toBe("0.01");
  });

  it("accepts the value as a string", () => {
    const result = calculateCommission(
      makeInput({ config: makeConfig({ value: "5" }) }),
    );

    expect(result.type).toBe(CommissionType.PERCENTAGE);
    expect(result.value?.toString()).toBe("5");
    expect(result.amount.toString()).toBe("900");
  });
});
