/**
 * Tests for field requirement functions.
 *
 * Every function accepts both a bare StrictnessConfig and an EffectiveConfig
 * (which nests strictness under a `strictness` property). Both paths are
 * tested here.
 */
import { describe, expect, it } from "vitest";
import {
  getLotRequirement,
  getExpiryDateRequirement,
  getStockValidationBehavior,
  getClientRequirement,
  getPrescriptionEnforcementBehavior,
  getAdjustmentReasonRequirement,
  getReturnsOriginalSaleRequirement,
  isCashShiftRequired,
  getReceiptPrintRequirement,
  getAutoOpenDrawerBehavior,
  isCustomerDisplayRequired,
  getPrescriptionExpiryDays,
} from "./field-requirements";
import type { StrictnessConfig, EffectiveConfig, FieldRequirement } from "./types";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeStrictness(
  overrides?: Partial<StrictnessConfig>,
): StrictnessConfig {
  return {
    lots: "OPTIONAL",
    expiryDates: "OPTIONAL",
    stockValidation: "WARN",
    clientRequired: "ABOVE_AMOUNT",
    clientRequiredThreshold: 50000,
    prescriptionEnforcement: "STRICT",
    inventoryAdjustmentReason: "OPTIONAL",
    returnsRequireOriginalSale: "STRICT",
    cashShiftRequired: true,
    receiptPrintRequired: "STRICT",
    autoOpenDrawer: "CASH_ONLY",
    customerDisplayRequired: false,
    prescriptionExpiryDays: 180,
    ...overrides,
  };
}

function makeEffectiveConfig(
  overrides?: Partial<StrictnessConfig>,
): EffectiveConfig {
  return {
    strictness: makeStrictness(overrides),
    fiscal: {} as any,
    workflow: {} as any,
    customCompanyFields: [],
    customStrictnessToggles: [],
    activePresetCode: "BALANCED",
    configVersion: 1,
  };
}

// ---------------------------------------------------------------------------
// Tests — getLotRequirement
// ---------------------------------------------------------------------------

describe("getLotRequirement", () => {
  it("returns REQUIRED for STRICT level", () => {
    expect(getLotRequirement(makeStrictness({ lots: "STRICT" }))).toBe(
      "REQUIRED" satisfies FieldRequirement,
    );
  });

  it("returns OPTIONAL for OPTIONAL level", () => {
    expect(getLotRequirement(makeStrictness({ lots: "OPTIONAL" }))).toBe(
      "OPTIONAL" satisfies FieldRequirement,
    );
  });

  it("returns HIDDEN for OFF level", () => {
    expect(getLotRequirement(makeStrictness({ lots: "OFF" }))).toBe(
      "HIDDEN" satisfies FieldRequirement,
    );
  });

  it("works with EffectiveConfig", () => {
    expect(getLotRequirement(makeEffectiveConfig({ lots: "STRICT" }))).toBe(
      "REQUIRED",
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — getExpiryDateRequirement
// ---------------------------------------------------------------------------

describe("getExpiryDateRequirement", () => {
  it("returns REQUIRED for STRICT level", () => {
    expect(
      getExpiryDateRequirement(makeStrictness({ expiryDates: "STRICT" })),
    ).toBe("REQUIRED");
  });

  it("returns OPTIONAL for OPTIONAL level", () => {
    expect(
      getExpiryDateRequirement(makeStrictness({ expiryDates: "OPTIONAL" })),
    ).toBe("OPTIONAL");
  });

  it("returns HIDDEN for OFF level", () => {
    expect(
      getExpiryDateRequirement(makeStrictness({ expiryDates: "OFF" })),
    ).toBe("HIDDEN");
  });

  it("works with EffectiveConfig", () => {
    expect(
      getExpiryDateRequirement(makeEffectiveConfig({ expiryDates: "STRICT" })),
    ).toBe("REQUIRED");
  });
});

// ---------------------------------------------------------------------------
// Tests — getStockValidationBehavior
// ---------------------------------------------------------------------------

describe("getStockValidationBehavior", () => {
  it("returns BLOCK for STRICT", () => {
    expect(
      getStockValidationBehavior(makeStrictness({ stockValidation: "STRICT" })),
    ).toBe("BLOCK");
  });

  it("returns WARN for WARN", () => {
    expect(
      getStockValidationBehavior(makeStrictness({ stockValidation: "WARN" })),
    ).toBe("WARN");
  });

  it("returns SKIP for OFF", () => {
    expect(
      getStockValidationBehavior(makeStrictness({ stockValidation: "OFF" })),
    ).toBe("SKIP");
  });
});

// ---------------------------------------------------------------------------
// Tests — getClientRequirement
// ---------------------------------------------------------------------------

describe("getClientRequirement", () => {
  it("returns REQUIRED for ALWAYS", () => {
    expect(
      getClientRequirement(
        makeStrictness({ clientRequired: "ALWAYS" }),
        0,
      ),
    ).toBe("REQUIRED");
  });

  it("returns HIDDEN for NEVER", () => {
    expect(
      getClientRequirement(
        makeStrictness({ clientRequired: "NEVER" }),
        0,
      ),
    ).toBe("HIDDEN");
  });

  describe("ABOVE_AMOUNT", () => {
    it("returns REQUIRED when sale total is at or above threshold", () => {
      expect(
        getClientRequirement(
          makeStrictness({
            clientRequired: "ABOVE_AMOUNT",
            clientRequiredThreshold: 50000,
          }),
          50000,
        ),
      ).toBe("REQUIRED");
    });

    it("returns REQUIRED when sale total exceeds threshold", () => {
      expect(
        getClientRequirement(
          makeStrictness({
            clientRequired: "ABOVE_AMOUNT",
            clientRequiredThreshold: 50000,
          }),
          75000,
        ),
      ).toBe("REQUIRED");
    });

    it("returns OPTIONAL when sale total is below threshold", () => {
      expect(
        getClientRequirement(
          makeStrictness({
            clientRequired: "ABOVE_AMOUNT",
            clientRequiredThreshold: 50000,
          }),
          10000,
        ),
      ).toBe("OPTIONAL");
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — getPrescriptionEnforcementBehavior
// ---------------------------------------------------------------------------

describe("getPrescriptionEnforcementBehavior", () => {
  it("returns BLOCK for STRICT", () => {
    expect(
      getPrescriptionEnforcementBehavior(
        makeStrictness({ prescriptionEnforcement: "STRICT" }),
      ),
    ).toBe("BLOCK");
  });

  it("returns WARN for WARN", () => {
    expect(
      getPrescriptionEnforcementBehavior(
        makeStrictness({ prescriptionEnforcement: "WARN" }),
      ),
    ).toBe("WARN");
  });

  it("returns SKIP for OFF", () => {
    expect(
      getPrescriptionEnforcementBehavior(
        makeStrictness({ prescriptionEnforcement: "OFF" }),
      ),
    ).toBe("SKIP");
  });
});

// ---------------------------------------------------------------------------
// Tests — getAdjustmentReasonRequirement
// ---------------------------------------------------------------------------

describe("getAdjustmentReasonRequirement", () => {
  it("returns REQUIRED for REQUIRED", () => {
    expect(
      getAdjustmentReasonRequirement(
        makeStrictness({ inventoryAdjustmentReason: "REQUIRED" }),
      ),
    ).toBe("REQUIRED");
  });

  it("returns OPTIONAL for OPTIONAL", () => {
    expect(
      getAdjustmentReasonRequirement(
        makeStrictness({ inventoryAdjustmentReason: "OPTIONAL" }),
      ),
    ).toBe("OPTIONAL");
  });
});

// ---------------------------------------------------------------------------
// Tests — getReturnsOriginalSaleRequirement
// ---------------------------------------------------------------------------

describe("getReturnsOriginalSaleRequirement", () => {
  it("returns REQUIRED for STRICT", () => {
    expect(
      getReturnsOriginalSaleRequirement(
        makeStrictness({ returnsRequireOriginalSale: "STRICT" }),
      ),
    ).toBe("REQUIRED");
  });

  it("returns MANAGER_AUTH for WITH_MANAGER_AUTH", () => {
    expect(
      getReturnsOriginalSaleRequirement(
        makeStrictness({
          returnsRequireOriginalSale: "WITH_MANAGER_AUTH",
        }),
      ),
    ).toBe("MANAGER_AUTH");
  });

  it("returns OFF for OFF", () => {
    expect(
      getReturnsOriginalSaleRequirement(
        makeStrictness({ returnsRequireOriginalSale: "OFF" }),
      ),
    ).toBe("OFF");
  });
});

// ---------------------------------------------------------------------------
// Tests — isCashShiftRequired
// ---------------------------------------------------------------------------

describe("isCashShiftRequired", () => {
  it("returns true when cashShiftRequired is true", () => {
    expect(
      isCashShiftRequired(makeStrictness({ cashShiftRequired: true })),
    ).toBe(true);
  });

  it("returns false when cashShiftRequired is false", () => {
    expect(
      isCashShiftRequired(makeStrictness({ cashShiftRequired: false })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — getReceiptPrintRequirement
// ---------------------------------------------------------------------------

describe("getReceiptPrintRequirement", () => {
  it("returns REQUIRED for STRICT", () => {
    expect(
      getReceiptPrintRequirement(
        makeStrictness({ receiptPrintRequired: "STRICT" }),
      ),
    ).toBe("REQUIRED");
  });

  it("returns OPTIONAL for OPTIONAL", () => {
    expect(
      getReceiptPrintRequirement(
        makeStrictness({ receiptPrintRequired: "OPTIONAL" }),
      ),
    ).toBe("OPTIONAL");
  });

  it("returns HIDDEN for OFF", () => {
    expect(
      getReceiptPrintRequirement(
        makeStrictness({ receiptPrintRequired: "OFF" }),
      ),
    ).toBe("HIDDEN");
  });
});

// ---------------------------------------------------------------------------
// Tests — getAutoOpenDrawerBehavior
// ---------------------------------------------------------------------------

describe("getAutoOpenDrawerBehavior", () => {
  it("returns 'ALWAYS' for ALWAYS", () => {
    expect(
      getAutoOpenDrawerBehavior(
        makeStrictness({ autoOpenDrawer: "ALWAYS" }),
      ),
    ).toBe("ALWAYS");
  });

  it("returns 'CASH_ONLY' for CASH_ONLY", () => {
    expect(
      getAutoOpenDrawerBehavior(
        makeStrictness({ autoOpenDrawer: "CASH_ONLY" }),
      ),
    ).toBe("CASH_ONLY");
  });

  it("returns 'MANUAL' for MANUAL", () => {
    expect(
      getAutoOpenDrawerBehavior(
        makeStrictness({ autoOpenDrawer: "MANUAL" }),
      ),
    ).toBe("MANUAL");
  });
});

// ---------------------------------------------------------------------------
// Tests — isCustomerDisplayRequired
// ---------------------------------------------------------------------------

describe("isCustomerDisplayRequired", () => {
  it("returns true when customerDisplayRequired is true", () => {
    expect(
      isCustomerDisplayRequired(
        makeStrictness({ customerDisplayRequired: true }),
      ),
    ).toBe(true);
  });

  it("returns false when customerDisplayRequired is false", () => {
    expect(
      isCustomerDisplayRequired(
        makeStrictness({ customerDisplayRequired: false }),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — getPrescriptionExpiryDays
// ---------------------------------------------------------------------------

describe("getPrescriptionExpiryDays", () => {
  it("returns the configured number of days", () => {
    expect(
      getPrescriptionExpiryDays(
        makeStrictness({ prescriptionExpiryDays: 90 }),
      ),
    ).toBe(90);
  });

  it("returns 180 as the default", () => {
    expect(getPrescriptionExpiryDays(makeStrictness())).toBe(180);
  });
});
