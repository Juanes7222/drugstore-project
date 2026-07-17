/**
 * Tests for ConfigService HTTP client.
 *
 * Tests that every method on the service calls the correct HTTP method
 * and path via the injected ConfigHttpClient mock.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createConfigService,
  ConfigHttpError,
  type ConfigService,
  type ConfigHttpClient,
} from "./config.service";
import type { TenantConfig, PresetCode, CustomCompanyField } from "./types";

// ---------------------------------------------------------------------------
// Mock HTTP client factory
// ---------------------------------------------------------------------------

function makeMockHttpClient(): ConfigHttpClient {
  return {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeTenantConfig(
  overrides?: Partial<TenantConfig>,
): TenantConfig {
  return {
    activePresetCode: "BALANCED" as PresetCode,
    strictness: {},
    fiscal: {},
    workflow: {},
    customCompanyFields: [],
    customStrictnessToggles: [],
    configVersion: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConfigService", () => {
  let http: ConfigHttpClient;
  let service: ConfigService;

  beforeEach(() => {
    http = makeMockHttpClient();
    service = createConfigService({ httpClient: http });
  });

  describe("getCurrent", () => {
    it("calls GET /tenant-config", async () => {
      const expected = makeTenantConfig();
      vi.mocked(http.get).mockResolvedValue(expected);

      const result = await service.getCurrent();

      expect(http.get).toHaveBeenCalledWith("/tenant-config");
      expect(result).toEqual(expected);
    });
  });

  describe("update", () => {
    it("calls PUT /tenant-config with expectedConfigVersion", async () => {
      const expected = makeTenantConfig({ configVersion: 2 });
      const updates = { strictness: { lots: "STRICT" } };
      vi.mocked(http.put).mockResolvedValue(expected);

      const result = await service.update(updates, 1);

      expect(http.put).toHaveBeenCalledWith("/tenant-config", {
        ...updates,
        expectedConfigVersion: 1,
      });
      expect(result).toEqual(expected);
    });
  });

  describe("applyPreset", () => {
    it("calls POST /tenant-config/apply-preset with presetCode", async () => {
      const expected = makeTenantConfig({ activePresetCode: "STRICT" as PresetCode });
      vi.mocked(http.post).mockResolvedValue(expected);

      const result = await service.applyPreset("STRICT");

      expect(http.post).toHaveBeenCalledWith(
        "/tenant-config/apply-preset",
        { presetCode: "STRICT" },
      );
      expect(result).toEqual(expected);
    });
  });

  describe("resetToPreset", () => {
    it("calls POST /tenant-config/reset-to-preset", async () => {
      const expected = makeTenantConfig();
      vi.mocked(http.post).mockResolvedValue(expected);

      const result = await service.resetToPreset();

      expect(http.post).toHaveBeenCalledWith(
        "/tenant-config/reset-to-preset",
      );
      expect(result).toEqual(expected);
    });
  });

  describe("addCustomField", () => {
    it("calls POST /tenant-config/custom-fields with the field body", async () => {
      const field: CustomCompanyField = {
        key: "licencia",
        name: "Licencia",
        type: "TEXT",
        order: 1,
      };
      const expected = makeTenantConfig({
        customCompanyFields: [field],
      });
      vi.mocked(http.post).mockResolvedValue(expected);

      const result = await service.addCustomField(field);

      expect(http.post).toHaveBeenCalledWith(
        "/tenant-config/custom-fields",
        field,
      );
      expect(result).toEqual(expected);
    });
  });

  describe("updateCustomField", () => {
    it("calls PATCH /tenant-config/custom-fields/:fieldId", async () => {
      const expected = makeTenantConfig();
      const updates = { name: "Updated Name" };
      vi.mocked(http.patch).mockResolvedValue(expected);

      const result = await service.updateCustomField("field-1", updates);

      expect(http.patch).toHaveBeenCalledWith(
        "/tenant-config/custom-fields/field-1",
        updates,
      );
      expect(result).toEqual(expected);
    });
  });

  describe("removeCustomField", () => {
    it("calls DELETE /tenant-config/custom-fields/:fieldId", async () => {
      const expected = makeTenantConfig();
      vi.mocked(http.delete).mockResolvedValue(expected);

      const result = await service.removeCustomField("field-1");

      expect(http.delete).toHaveBeenCalledWith(
        "/tenant-config/custom-fields/field-1",
      );
      expect(result).toEqual(expected);
    });
  });

  describe("addCustomToggle", () => {
    it("calls POST /tenant-config/custom-toggles", async () => {
      const toggle = {
        key: "requireDoctorId",
        type: "BOOLEAN" as const,
        label: "Requiere ID Doctor",
        appliesTo: "SALE" as const,
        defaultValue: false,
      };
      const expected = makeTenantConfig();
      vi.mocked(http.post).mockResolvedValue(expected);

      const result = await service.addCustomToggle(toggle);

      expect(http.post).toHaveBeenCalledWith(
        "/tenant-config/custom-toggles",
        toggle,
      );
      expect(result).toEqual(expected);
    });
  });

  describe("updateCustomToggle", () => {
    it("calls PATCH /tenant-config/custom-toggles/:toggleId", async () => {
      const expected = makeTenantConfig();
      vi.mocked(http.patch).mockResolvedValue(expected);

      const result = await service.updateCustomToggle("toggle-1", {
        label: "Updated",
      });

      expect(http.patch).toHaveBeenCalledWith(
        "/tenant-config/custom-toggles/toggle-1",
        { label: "Updated" },
      );
      expect(result).toEqual(expected);
    });
  });

  describe("removeCustomToggle", () => {
    it("calls DELETE /tenant-config/custom-toggles/:toggleId", async () => {
      const expected = makeTenantConfig();
      vi.mocked(http.delete).mockResolvedValue(expected);

      const result = await service.removeCustomToggle("toggle-1");

      expect(http.delete).toHaveBeenCalledWith(
        "/tenant-config/custom-toggles/toggle-1",
      );
      expect(result).toEqual(expected);
    });
  });

  describe("getHistory", () => {
    it("calls GET /tenant-config/history", async () => {
      const history = [{ version: 1, changedAt: "2026-01-01T00:00:00Z" }];
      vi.mocked(http.get).mockResolvedValue(history);

      const result = await service.getHistory();

      expect(http.get).toHaveBeenCalledWith("/tenant-config/history");
      expect(result).toEqual(history);
    });
  });

  describe("rollback", () => {
    it("calls POST /tenant-config/rollback/:version", async () => {
      const expected = makeTenantConfig({ configVersion: 1 });
      vi.mocked(http.post).mockResolvedValue(expected);

      const result = await service.rollback(1);

      expect(http.post).toHaveBeenCalledWith(
        "/tenant-config/rollback/1",
      );
      expect(result).toEqual(expected);
    });
  });

  describe("saveAsNamedPreset", () => {
    it("calls POST /tenant-config/named-presets", async () => {
      const namedPreset = { id: "np-1", name: "Mi Config" };
      vi.mocked(http.post).mockResolvedValue(namedPreset);

      const result = await service.saveAsNamedPreset(
        "Mi Config",
        "Description",
        true,
      );

      expect(http.post).toHaveBeenCalledWith(
        "/tenant-config/named-presets",
        { name: "Mi Config", description: "Description", isShared: true },
      );
      expect(result).toEqual(namedPreset);
    });
  });

  describe("listNamedPresets", () => {
    it("calls GET /tenant-config/named-presets", async () => {
      const presets = [{ id: "np-1", name: "Mi Config" }];
      vi.mocked(http.get).mockResolvedValue(presets);

      const result = await service.listNamedPresets();

      expect(http.get).toHaveBeenCalledWith(
        "/tenant-config/named-presets",
      );
      expect(result).toEqual(presets);
    });
  });

  describe("applyNamedPreset", () => {
    it("calls POST /tenant-config/named-presets/:presetId/apply", async () => {
      const expected = makeTenantConfig();
      vi.mocked(http.post).mockResolvedValue(expected);

      const result = await service.applyNamedPreset("np-1");

      expect(http.post).toHaveBeenCalledWith(
        "/tenant-config/named-presets/np-1/apply",
      );
      expect(result).toEqual(expected);
    });
  });

  describe("deleteNamedPreset", () => {
    it("calls DELETE /tenant-config/named-presets/:presetId", async () => {
      vi.mocked(http.delete).mockResolvedValue(undefined);

      await service.deleteNamedPreset("np-1");

      expect(http.delete).toHaveBeenCalledWith(
        "/tenant-config/named-presets/np-1",
      );
    });
  });

  describe("getSyncPayload", () => {
    it("calls GET /tenant-config and bundles preset definitions", async () => {
      const config = makeTenantConfig();
      vi.mocked(http.get).mockResolvedValue(config);

      const result = await service.getSyncPayload();

      expect(http.get).toHaveBeenCalledWith("/tenant-config");
      expect(result.config).toEqual(config);
      expect(result.presets).toHaveLength(4);
      expect(result.presets[0]?.code).toBe("SIMPLE");
      expect(result.presets[1]?.code).toBe("BALANCED");
    });
  });

  describe("HTTP error", () => {
    it("throws ConfigHttpError on non-ok response", async () => {
      vi.mocked(http.get).mockRejectedValue(
        new ConfigHttpError(
          500,
          '{"message":"Server error"}',
          "Config HTTP GET /tenant-config failed: 500",
        ),
      );

      await expect(service.getCurrent()).rejects.toThrow(ConfigHttpError);
    });

    it("includes status code in ConfigHttpError", async () => {
      vi.mocked(http.get).mockRejectedValue(
        new ConfigHttpError(500, "", "error"),
      );

      try {
        await service.getCurrent();
        expect.unreachable("Should have thrown");
      } catch (e) {
        if (e instanceof ConfigHttpError) {
          expect(e.statusCode).toBe(500);
        } else {
          throw e;
        }
      }
    });

    it("includes response body in ConfigHttpError", async () => {
      const body = '{"message":"Conflict","error":"version mismatch"}';
      vi.mocked(http.get).mockRejectedValue(
        new ConfigHttpError(409, body, "error"),
      );

      try {
        await service.getCurrent();
        expect.unreachable("Should have thrown");
      } catch (e) {
        if (e instanceof ConfigHttpError) {
          expect(e.responseBody).toContain("version mismatch");
        } else {
          throw e;
        }
      }
    });
  });
});
