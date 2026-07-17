/**
 * Tests for tenant configuration validation functions.
 *
 * All validators are pure functions that return arrays of
 * ConfigValidationError — they never throw.
 */
import { describe, expect, it } from "vitest";
import { validateTenantConfig, validatePresetCode } from "./validation";
import type {
  TenantConfig,
  StrictnessConfig,
  FiscalConfig,
  WorkflowConfig,
  CustomCompanyField,
  CustomStrictnessToggle,
} from "./types";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makePartialConfig(
  overrides?: Partial<TenantConfig>,
): Partial<TenantConfig> {
  return {
    strictness: {
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
    },
    fiscal: {
      companyName: "Farmacia Salud",
      nit: "1234567890",
      address: "Calle 123",
      city: "Bogota",
      phone: "3001234567",
      email: "info@farmaciasalud.com",
      taxRegime: "RESPONSABLE_IVA",
      defaultTaxRate: 0.19,
    },
    workflow: {
      defaultPaymentMethodId: null,
      autoPrintOnConfirm: true,
      requireShiftOpenForSale: true,
      maxOfflineLoginDays: 30,
    },
    customCompanyFields: [],
    customStrictnessToggles: [],
    activePresetCode: "BALANCED",
    configVersion: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — validateTenantConfig
// ---------------------------------------------------------------------------

describe("validateTenantConfig", () => {
  describe("valid config", () => {
    it("returns empty errors for a complete valid config", () => {
      const errors = validateTenantConfig(makePartialConfig());

      expect(errors).toEqual([]);
    });

    it("returns empty errors when no sections are provided", () => {
      const errors = validateTenantConfig({});

      expect(errors).toEqual([]);
    });
  });

  describe("company name", () => {
    it("returns error when companyName is an empty string", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          fiscal: { companyName: "" } as Partial<FiscalConfig>,
        }),
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]?.path).toBe("fiscal.companyName");
      expect(errors[0]?.code).toBe("REQUIRED");
    });

    it("returns error when companyName is whitespace only", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          fiscal: { companyName: "   " } as Partial<FiscalConfig>,
        }),
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]?.path).toBe("fiscal.companyName");
    });

    it("allows non-empty company name", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          fiscal: { companyName: "Mi Farmacia" } as Partial<FiscalConfig>,
        }),
      );

      const nameErrors = errors.filter(
        (e) => e.path === "fiscal.companyName",
      );
      expect(nameErrors).toHaveLength(0);
    });
  });

  describe("NIT format", () => {
    it("accepts valid 10-digit NIT", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          fiscal: { nit: "1234567890" } as Partial<FiscalConfig>,
        }),
      );

      const nitErrors = errors.filter((e) => e.path === "fiscal.nit");
      expect(nitErrors).toHaveLength(0);
    });

    it("accepts valid 9-digit NIT", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          fiscal: { nit: "123456789" } as Partial<FiscalConfig>,
        }),
      );

      const nitErrors = errors.filter((e) => e.path === "fiscal.nit");
      expect(nitErrors).toHaveLength(0);
    });

    it("rejects NIT with fewer than 9 digits", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          fiscal: { nit: "12345678" } as Partial<FiscalConfig>,
        }),
      );

      const nitErrors = errors.filter((e) => e.path === "fiscal.nit");
      expect(nitErrors).toHaveLength(1);
      expect(nitErrors[0]?.code).toBe("INVALID_FORMAT");
    });

    it("rejects NIT with non-numeric characters", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          fiscal: { nit: "abc1234567" } as Partial<FiscalConfig>,
        }),
      );

      const nitErrors = errors.filter((e) => e.path === "fiscal.nit");
      expect(nitErrors).toHaveLength(1);
    });

    it("strips dashes and spaces before validating NIT", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          fiscal: { nit: "123-456-7890" } as Partial<FiscalConfig>,
        }),
      );

      const nitErrors = errors.filter((e) => e.path === "fiscal.nit");
      expect(nitErrors).toHaveLength(0);
    });
  });

  describe("email", () => {
    it("accepts valid email", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          fiscal: {
            email: "admin@farmacia.com",
          } as Partial<FiscalConfig>,
        }),
      );

      const emailErrors = errors.filter((e) => e.path === "fiscal.email");
      expect(emailErrors).toHaveLength(0);
    });

    it("rejects invalid email", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          fiscal: { email: "not-an-email" } as Partial<FiscalConfig>,
        }),
      );

      const emailErrors = errors.filter((e) => e.path === "fiscal.email");
      expect(emailErrors).toHaveLength(1);
      expect(emailErrors[0]?.code).toBe("INVALID_FORMAT");
    });

    it("allows empty email (not validated)", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          fiscal: { email: "" } as Partial<FiscalConfig>,
        }),
      );

      const emailErrors = errors.filter((e) => e.path === "fiscal.email");
      expect(emailErrors).toHaveLength(0);
    });
  });

  describe("tax rate", () => {
    it("accepts 0.19", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          fiscal: { defaultTaxRate: 0.19 } as Partial<FiscalConfig>,
        }),
      );

      const taxErrors = errors.filter(
        (e) => e.path === "fiscal.defaultTaxRate",
      );
      expect(taxErrors).toHaveLength(0);
    });

    it("accepts 0", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          fiscal: { defaultTaxRate: 0 } as Partial<FiscalConfig>,
        }),
      );

      const taxErrors = errors.filter(
        (e) => e.path === "fiscal.defaultTaxRate",
      );
      expect(taxErrors).toHaveLength(0);
    });

    it("rejects negative tax rate", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          fiscal: { defaultTaxRate: -0.1 } as Partial<FiscalConfig>,
        }),
      );

      const taxErrors = errors.filter(
        (e) => e.path === "fiscal.defaultTaxRate",
      );
      expect(taxErrors).toHaveLength(1);
      expect(taxErrors[0]?.code).toBe("INVALID_VALUE");
    });

    it("rejects tax rate greater than 1", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          fiscal: { defaultTaxRate: 1.5 } as Partial<FiscalConfig>,
        }),
      );

      const taxErrors = errors.filter(
        (e) => e.path === "fiscal.defaultTaxRate",
      );
      expect(taxErrors).toHaveLength(1);
    });

    it("rejects non-number tax rate", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          fiscal: {
            defaultTaxRate: "0.19" as unknown as number,
          } as Partial<FiscalConfig>,
        }),
      );

      const taxErrors = errors.filter(
        (e) => e.path === "fiscal.defaultTaxRate",
      );
      expect(taxErrors).toHaveLength(1);
    });
  });

  describe("maxOfflineLoginDays", () => {
    it("accepts value within range", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          workflow: { maxOfflineLoginDays: 30 } as Partial<WorkflowConfig>,
        }),
      );

      const wfErrors = errors.filter(
        (e) => e.path === "workflow.maxOfflineLoginDays",
      );
      expect(wfErrors).toHaveLength(0);
    });

    it("rejects value below 1", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          workflow: { maxOfflineLoginDays: 0 } as Partial<WorkflowConfig>,
        }),
      );

      const wfErrors = errors.filter(
        (e) => e.path === "workflow.maxOfflineLoginDays",
      );
      expect(wfErrors).toHaveLength(1);
      expect(wfErrors[0]?.code).toBe("OUT_OF_RANGE");
    });

    it("rejects value above 365", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          workflow: { maxOfflineLoginDays: 400 } as Partial<WorkflowConfig>,
        }),
      );

      const wfErrors = errors.filter(
        (e) => e.path === "workflow.maxOfflineLoginDays",
      );
      expect(wfErrors).toHaveLength(1);
    });
  });

  describe("strictness field validation", () => {
    it("rejects invalid lots value", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          strictness: { lots: "INVALID" } as unknown as Partial<StrictnessConfig>,
        }),
      );

      expect(errors.some((e) => e.path === "strictness.lots")).toBe(true);
    });

    it("rejects invalid stockValidation value", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          strictness: {
            stockValidation: "INVALID",
          } as unknown as Partial<StrictnessConfig>,
        }),
      );

      expect(
        errors.some((e) => e.path === "strictness.stockValidation"),
      ).toBe(true);
    });

    it("rejects invalid clientRequired value", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          strictness: {
            clientRequired: "INVALID",
          } as unknown as Partial<StrictnessConfig>,
        }),
      );

      expect(
        errors.some((e) => e.path === "strictness.clientRequired"),
      ).toBe(true);
    });
  });

  describe("custom fields — duplicate keys", () => {
    it("returns error for duplicate custom field keys", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          customCompanyFields: [
            { key: "licencia", name: "Licencia", type: "TEXT", order: 1 },
            { key: "licencia", name: "Licencia 2", type: "TEXT", order: 2 },
          ],
        }),
      );

      expect(
        errors.some((e) => e.code === "DUPLICATE_KEY"),
      ).toBe(true);
    });

    it("returns error for empty custom field key", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          customCompanyFields: [
            { key: "", name: "Empty Key", type: "TEXT", order: 1 },
          ],
        }),
      );

      expect(errors.some((e) => e.code === "REQUIRED")).toBe(true);
    });

    it("returns error for invalid custom field type", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          customCompanyFields: [
            {
              key: "test",
              name: "Test",
              type: "INVALID" as any,
              order: 1,
            },
          ],
        }),
      );

      expect(errors.some((e) => e.code === "INVALID_VALUE")).toBe(true);
    });

    it("returns error for missing custom field name", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          customCompanyFields: [
            { key: "test", name: "", type: "TEXT", order: 1 },
          ],
        }),
      );

      expect(errors.some((e) => e.code === "REQUIRED")).toBe(true);
    });

    it("returns error for negative field order", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          customCompanyFields: [
            { key: "test", name: "Test", type: "TEXT", order: -1 },
          ],
        }),
      );

      expect(errors.some((e) => e.code === "INVALID_VALUE")).toBe(true);
    });
  });

  describe("custom toggles — key collision", () => {
    it("returns error when custom toggle key matches a known strictness key", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          customStrictnessToggles: [
            {
              key: "lots",
              type: "BOOLEAN",
              label: "Override Lots",
              appliesTo: "SALE",
              defaultValue: false,
            },
          ],
        }),
      );

      expect(
        errors.some((e) => e.code === "KEY_COLLISION"),
      ).toBe(true);
    });

    it("returns error for duplicate custom toggle keys", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          customStrictnessToggles: [
            {
              key: "requireDoctorId",
              type: "BOOLEAN",
              label: "Requiere ID Doctor",
              appliesTo: "SALE",
              defaultValue: false,
            },
            {
              key: "requireDoctorId",
              type: "BOOLEAN",
              label: "Duplicado",
              appliesTo: "SALE",
              defaultValue: true,
            },
          ],
        }),
      );

      expect(
        errors.some((e) => e.code === "DUPLICATE_KEY"),
      ).toBe(true);
    });

    it("returns error for invalid custom toggle type", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          customStrictnessToggles: [
            {
              key: "test",
              type: "INVALID" as any,
              label: "Test",
              appliesTo: "SALE",
              defaultValue: "",
            },
          ],
        }),
      );

      expect(errors.some((e) => e.code === "INVALID_VALUE")).toBe(true);
    });

    it("returns error for invalid appliesTo value", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          customStrictnessToggles: [
            {
              key: "test",
              type: "BOOLEAN",
              label: "Test",
              appliesTo: "INVALID" as any,
              defaultValue: false,
            },
          ],
        }),
      );

      expect(errors.some((e) => e.code === "INVALID_VALUE")).toBe(true);
    });
  });

  describe("cross-validation — ABOVE_AMOUNT without threshold", () => {
    it("returns error when clientRequired is ABOVE_AMOUNT but threshold is missing", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          strictness: {
            clientRequired: "ABOVE_AMOUNT",
            clientRequiredThreshold: undefined,
          } as unknown as Partial<StrictnessConfig>,
        }),
      );

      expect(
        errors.some((e) => e.code === "CROSS_FIELD_MISSING"),
      ).toBe(true);
    });

    it("returns error when threshold is 0", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          strictness: {
            clientRequired: "ABOVE_AMOUNT",
            clientRequiredThreshold: 0,
          },
        }),
      );

      expect(
        errors.some((e) => e.code === "CROSS_FIELD_MISSING"),
      ).toBe(true);
    });

    it("returns error when threshold is null", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          strictness: {
            clientRequired: "ABOVE_AMOUNT",
            clientRequiredThreshold: null,
          } as unknown as Partial<StrictnessConfig>,
        }),
      );

      expect(
        errors.some((e) => e.code === "CROSS_FIELD_MISSING"),
      ).toBe(true);
    });

    it("passes when ABOVE_AMOUNT has a valid positive threshold", () => {
      const errors = validateTenantConfig(
        makePartialConfig({
          strictness: {
            clientRequired: "ABOVE_AMOUNT",
            clientRequiredThreshold: 50000,
          },
        }),
      );

      expect(
        errors.some((e) => e.code === "CROSS_FIELD_MISSING"),
      ).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — validatePresetCode
// ---------------------------------------------------------------------------

describe("validatePresetCode", () => {
  it("returns empty errors for 'SIMPLE'", () => {
    expect(validatePresetCode("SIMPLE")).toEqual([]);
  });

  it("returns empty errors for 'BALANCED'", () => {
    expect(validatePresetCode("BALANCED")).toEqual([]);
  });

  it("returns empty errors for 'STRICT'", () => {
    expect(validatePresetCode("STRICT")).toEqual([]);
  });

  it("returns empty errors for 'CUSTOM'", () => {
    expect(validatePresetCode("CUSTOM")).toEqual([]);
  });

  it("returns error for an unknown preset code", () => {
    const errors = validatePresetCode("UNKNOWN");

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("UNKNOWN_PRESET");
    expect(errors[0]?.path).toBe("activePresetCode");
  });

  it("returns error for empty string", () => {
    const errors = validatePresetCode("");

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("UNKNOWN_PRESET");
  });

  it("is case-sensitive", () => {
    const errors = validatePresetCode("balanced");

    expect(errors).toHaveLength(1);
  });
});
