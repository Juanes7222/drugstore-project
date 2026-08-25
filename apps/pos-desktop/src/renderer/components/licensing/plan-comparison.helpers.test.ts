/**
 * Unit tests for plan-comparison.helpers — pure delta logic behind the
 * switch-plan ledger: unlimited-location detection, feature diff, monthly
 * price delta, billing-method normalization and trade-off key lookup.
 */
import { describe, expect, it } from "vitest";
import {
  UNLIMITED_LOCATIONS_SENTINEL,
  computeFeatureDelta,
  getBillingTradeoff,
  isUnlimitedLocations,
  monthlyPriceDeltaCents,
  normalizeBillingMethod,
} from "./plan-comparison.helpers";

describe("isUnlimitedLocations", () => {
  it("returns true when features include UNLIMITED_LOCATIONS", () => {
    expect(isUnlimitedLocations(3, ["MULTI_LOCATION", "UNLIMITED_LOCATIONS"])).toBe(true);
  });

  it("returns true when maxLocations is null", () => {
    expect(isUnlimitedLocations(null, [])).toBe(true);
  });

  it(`returns true at the ${UNLIMITED_LOCATIONS_SENTINEL} sentinel`, () => {
    expect(isUnlimitedLocations(UNLIMITED_LOCATIONS_SENTINEL, [])).toBe(true);
  });

  it("returns true above the sentinel", () => {
    expect(isUnlimitedLocations(UNLIMITED_LOCATIONS_SENTINEL + 1, [])).toBe(true);
  });

  it("returns false for a finite cap without the feature", () => {
    expect(isUnlimitedLocations(5, ["MULTI_LOCATION"])).toBe(false);
  });
});

describe("computeFeatureDelta", () => {
  it("returns gained features in candidate order", () => {
    const delta = computeFeatureDelta(
      ["OFFLINE_MODE"],
      ["API_ACCESS", "OFFLINE_MODE", "WHITE_LABEL"],
    );

    expect(delta.gained).toEqual(["API_ACCESS", "WHITE_LABEL"]);
  });

  it("returns lost features in current order", () => {
    const delta = computeFeatureDelta(
      ["PRIORITY_SUPPORT", "OFFLINE_MODE"],
      ["OFFLINE_MODE"],
    );

    expect(delta.lost).toEqual(["PRIORITY_SUPPORT"]);
  });

  it("returns empty arrays for identical feature sets", () => {
    const delta = computeFeatureDelta(["A", "B"], ["B", "A"]);

    expect(delta.gained).toEqual([]);
    expect(delta.lost).toEqual([]);
  });
});

describe("monthlyPriceDeltaCents", () => {
  it("is positive when the candidate costs more", () => {
    expect(monthlyPriceDeltaCents(199_900, 299_900)).toBe(100_000);
  });

  it("is negative when the candidate costs less", () => {
    expect(monthlyPriceDeltaCents(199_900, 99_900)).toBe(-100_000);
  });

  it("is zero for equal prices", () => {
    expect(monthlyPriceDeltaCents(199_900, 199_900)).toBe(0);
  });
});

describe("normalizeBillingMethod", () => {
  it("keeps CERTIFICATE as CERTIFICATE", () => {
    expect(normalizeBillingMethod("CERTIFICATE")).toBe("CERTIFICATE");
  });

  it("maps null legacy plans to PROVIDER", () => {
    expect(normalizeBillingMethod(null)).toBe("PROVIDER");
  });

  it("maps undefined to PROVIDER", () => {
    expect(normalizeBillingMethod(undefined)).toBe("PROVIDER");
  });

  it("maps PROVIDER to PROVIDER", () => {
    expect(normalizeBillingMethod("PROVIDER")).toBe("PROVIDER");
  });

  it("maps unknown codes to PROVIDER", () => {
    expect(normalizeBillingMethod("SOMETHING_ELSE")).toBe("PROVIDER");
  });
});

describe("getBillingTradeoff", () => {
  it("returns no keys when both plans bill through the provider", () => {
    expect(getBillingTradeoff("PROVIDER", "PROVIDER")).toEqual({
      gainsKey: null,
      considersKey: null,
    });
  });

  it("returns no keys when both plans use a certificate", () => {
    expect(getBillingTradeoff("CERTIFICATE", "CERTIFICATE")).toEqual({
      gainsKey: null,
      considersKey: null,
    });
  });

  it("describes the certificate burden when moving provider to certificate", () => {
    const tradeoff = getBillingTradeoff("PROVIDER", "CERTIFICATE");

    expect(tradeoff.gainsKey).toBe(
      "licensing.subscription.delta.billing.from_provider_to_certificate_gain",
    );
    expect(tradeoff.considersKey).toBe(
      "licensing.subscription.delta.billing.from_provider_to_certificate_consider",
    );
  });

  it("describes managed billing when moving certificate to provider", () => {
    const tradeoff = getBillingTradeoff("CERTIFICATE", "PROVIDER");

    expect(tradeoff.gainsKey).toBe(
      "licensing.subscription.delta.billing.from_certificate_to_provider_gain",
    );
    expect(tradeoff.considersKey).toBe(
      "licensing.subscription.delta.billing.from_certificate_to_provider_consider",
    );
  });

  it("treats a null legacy method as PROVIDER", () => {
    const tradeoff = getBillingTradeoff(null, "CERTIFICATE");

    expect(tradeoff.gainsKey).toBe(
      "licensing.subscription.delta.billing.from_provider_to_certificate_gain",
    );
    expect(tradeoff.considersKey).toBe(
      "licensing.subscription.delta.billing.from_provider_to_certificate_consider",
    );
  });
});
