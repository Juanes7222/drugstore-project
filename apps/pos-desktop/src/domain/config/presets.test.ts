/**
 * Tests for config preset definitions and lookup functions.
 */
import { describe, expect, it } from "vitest";
import {
  PRESET_SIMPLE,
  PRESET_BALANCED,
  PRESET_STRICT,
  PRESET_CUSTOM,
  PRESET_MAP,
  PRESET_LIST,
  getPreset,
} from "./presets";

describe("PRESET_SIMPLE", () => {
  it("has code 'SIMPLE'", () => {
    expect(PRESET_SIMPLE.code).toBe("SIMPLE");
  });

  it("has lenient strictness defaults", () => {
    expect(PRESET_SIMPLE.strictness.lots).toBe("OFF");
    expect(PRESET_SIMPLE.strictness.expiryDates).toBe("OFF");
    expect(PRESET_SIMPLE.strictness.clientRequired).toBe("NEVER");
    expect(PRESET_SIMPLE.strictness.cashShiftRequired).toBe(false);
  });
});

describe("PRESET_BALANCED", () => {
  it("has code 'BALANCED'", () => {
    expect(PRESET_BALANCED.code).toBe("BALANCED");
  });

  it("has moderate strictness defaults", () => {
    expect(PRESET_BALANCED.strictness.lots).toBe("OPTIONAL");
    expect(PRESET_BALANCED.strictness.clientRequired).toBe("ABOVE_AMOUNT");
    expect(PRESET_BALANCED.strictness.clientRequiredThreshold).toBe(50000);
    expect(PRESET_BALANCED.strictness.cashShiftRequired).toBe(true);
  });
});

describe("PRESET_STRICT", () => {
  it("has code 'STRICT'", () => {
    expect(PRESET_STRICT.code).toBe("STRICT");
  });

  it("has strict configuration", () => {
    expect(PRESET_STRICT.strictness.lots).toBe("STRICT");
    expect(PRESET_STRICT.strictness.expiryDates).toBe("STRICT");
    expect(PRESET_STRICT.strictness.stockValidation).toBe("STRICT");
    expect(PRESET_STRICT.strictness.clientRequired).toBe("ALWAYS");
    expect(PRESET_STRICT.strictness.customerDisplayRequired).toBe(true);
  });
});

describe("PRESET_CUSTOM", () => {
  it("has code 'CUSTOM'", () => {
    expect(PRESET_CUSTOM.code).toBe("CUSTOM");
  });

  it("has empty strictness object", () => {
    expect(PRESET_CUSTOM.strictness).toEqual({});
  });
});

describe("PRESET_MAP", () => {
  it("contains all 4 presets", () => {
    expect(PRESET_MAP.SIMPLE).toBe(PRESET_SIMPLE);
    expect(PRESET_MAP.BALANCED).toBe(PRESET_BALANCED);
    expect(PRESET_MAP.STRICT).toBe(PRESET_STRICT);
    expect(PRESET_MAP.CUSTOM).toBe(PRESET_CUSTOM);
  });

  it("has exactly 4 entries", () => {
    expect(Object.keys(PRESET_MAP)).toHaveLength(4);
  });

  it("does not contain an unknown code", () => {
    expect(PRESET_MAP.UNKNOWN).toBeUndefined();
  });
});

describe("PRESET_LIST", () => {
  it("has 4 presets in display order", () => {
    expect(PRESET_LIST).toHaveLength(4);
    expect(PRESET_LIST[0]).toBe(PRESET_SIMPLE);
    expect(PRESET_LIST[1]).toBe(PRESET_BALANCED);
    expect(PRESET_LIST[2]).toBe(PRESET_STRICT);
    expect(PRESET_LIST[3]).toBe(PRESET_CUSTOM);
  });
});

describe("getPreset", () => {
  it("returns PRESET_SIMPLE for 'SIMPLE'", () => {
    expect(getPreset("SIMPLE")).toBe(PRESET_SIMPLE);
  });

  it("returns PRESET_BALANCED for 'BALANCED'", () => {
    expect(getPreset("BALANCED")).toBe(PRESET_BALANCED);
  });

  it("returns PRESET_STRICT for 'STRICT'", () => {
    expect(getPreset("STRICT")).toBe(PRESET_STRICT);
  });

  it("returns PRESET_CUSTOM for 'CUSTOM'", () => {
    expect(getPreset("CUSTOM")).toBe(PRESET_CUSTOM);
  });

  it("returns undefined for an unknown code", () => {
    expect(getPreset("UNKNOWN")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(getPreset("")).toBeUndefined();
  });

  it("is case-sensitive", () => {
    expect(getPreset("simple")).toBeUndefined();
    expect(getPreset("Simple")).toBeUndefined();
  });
});
