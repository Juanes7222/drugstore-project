/**
 * Tests for the form memory service.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createFormMemoryService, type FormMemoryService } from "./form-memory.service";
import { useUserPreferencesStore } from "../../stores/user-preferences.store";

describe("FormMemoryService", () => {
  let fm: FormMemoryService;

  beforeEach(() => {
    window.localStorage.clear();
    useUserPreferencesStore.setState({
      dismissedSuggestions: [],
      dismissalCounts: {},
      customShortcuts: {},
      paletteRecentItems: [],
      helpViewedPages: {},
      formMemoryOptOuts: [],
      paletteUsageCount: 0,
      shortcutUsageCount: 0,
    });
    fm = createFormMemoryService();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe("remember", () => {
    it("stores a value for a form field", () => {
      fm.remember("inventory-form", "reason", "Producto dañado");

      const suggestions = fm.getSuggestions("inventory-form", "reason");
      expect(suggestions).toContain("Producto dañado");
    });

    it("adds new values to the front of the list", () => {
      fm.remember("inventory-form", "reason", "Vencimiento");
      fm.remember("inventory-form", "reason", "Producto dañado");

      const suggestions = fm.getSuggestions("inventory-form", "reason");
      expect(suggestions[0]).toBe("Producto dañado");
      expect(suggestions[1]).toBe("Vencimiento");
    });

    it("deduplicates values (moves to front)", () => {
      fm.remember("inventory-form", "reason", "Producto dañado");
      fm.remember("inventory-form", "reason", "Vencimiento");
      fm.remember("inventory-form", "reason", "Producto dañado");

      const suggestions = fm.getSuggestions("inventory-form", "reason");
      expect(suggestions).toEqual(["Producto dañado", "Vencimiento"]);
    });

    it("ignores empty or whitespace-only values", () => {
      fm.remember("form", "field", "");
      fm.remember("form", "field", "   ");

      expect(fm.getSuggestions("form", "field")).toEqual([]);
    });

    it("persists to localStorage", () => {
      fm.remember("form", "field", "test-value");

      const raw = window.localStorage.getItem("pos-form-memory");
      expect(raw).toBeTruthy();
      expect(raw).toContain("test-value");
    });

    it("restores data from localStorage on creation", () => {
      fm.remember("form", "field", "persisted-value");

      const fm2 = createFormMemoryService();
      const suggestions = fm2.getSuggestions("form", "field");

      expect(suggestions).toContain("persisted-value");
    });
  });

  describe("getSuggestions", () => {
    it("returns values most recent first", () => {
      fm.remember("form", "field", "third");
      fm.remember("form", "field", "second");
      fm.remember("form", "field", "first");

      expect(fm.getSuggestions("form", "field")).toEqual(["first", "second", "third"]);
    });

    it("returns empty array when no values stored", () => {
      expect(fm.getSuggestions("any-form", "any-field")).toEqual([]);
    });

    it("returns empty array when field is opted out", () => {
      fm.remember("form", "field", "some-value");
      useUserPreferencesStore.getState().optOutFormField("form::field");

      expect(fm.getSuggestions("form", "field")).toEqual([]);
    });
  });

  describe("isEnabled", () => {
    it("returns true by default", () => {
      expect(fm.isEnabled("form", "field")).toBe(true);
    });

    it("returns false after opt-out", () => {
      useUserPreferencesStore.getState().optOutFormField("form::field");

      expect(fm.isEnabled("form", "field")).toBe(false);
    });
  });

  describe("clearField", () => {
    it("clears values for a specific field", () => {
      fm.remember("form", "field1", "value1");
      fm.remember("form", "field2", "value2");

      fm.clearField("form", "field1");

      expect(fm.getSuggestions("form", "field1")).toEqual([]);
      expect(fm.getSuggestions("form", "field2")).toEqual(["value2"]);
    });
  });

  describe("clearAll", () => {
    it("clears all stored form memory", () => {
      fm.remember("form1", "field1", "value1");
      fm.remember("form2", "field2", "value2");

      fm.clearAll();

      expect(fm.getSuggestions("form1", "field1")).toEqual([]);
      expect(fm.getSuggestions("form2", "field2")).toEqual([]);
    });
  });

  describe("exportData", () => {
    it("returns all stored data", () => {
      fm.remember("form", "field", "value1");

      const data = fm.exportData();
      expect(data["form::field"]).toBeDefined();
      expect(data["form::field"]![0].value).toBe("value1");
    });
  });
});
