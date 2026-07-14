/**
 * Tests for the keyboard shortcut manager.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createShortcutManager, type ShortcutManager } from "./shortcut-manager";
import { ShortcutConflictException } from "./exceptions";

describe("ShortcutManager", () => {
  let manager: ShortcutManager;

  beforeEach(() => {
    manager = createShortcutManager();
  });

  describe("getBindings", () => {
    it("returns default bindings on creation", () => {
      const bindings = manager.getBindings();

      expect(bindings.length).toBeGreaterThanOrEqual(8);
    });

    it("returns bindings with required fields", () => {
      for (const binding of manager.getBindings()) {
        expect(binding.id).toBeTruthy();
        expect(binding.key).toBeTruthy();
        expect(binding.commandId).toBeTruthy();
        expect(binding.context).toMatch(/^(GLOBAL|SALE_FLOW|SHIFT_OPEN|MANAGER_ONLY|TEXT_INPUT|MODAL_OPEN)$/);
      }
    });

    it("includes a Cmd+K binding for palette", () => {
      const binding = manager.findBindingByKey("Cmd+K");
      expect(binding).toBeDefined();
      expect(binding!.commandId).toBe("cmd.open-palette");
    });
  });

  describe("getBindingsForContext", () => {
    it("returns only GLOBAL bindings", () => {
      const global = manager.getBindingsForContext("GLOBAL");

      for (const binding of global) {
        expect(binding.context).toBe("GLOBAL");
      }
    });

    it("returns only SALE_FLOW bindings", () => {
      const saleFlow = manager.getBindingsForContext("SALE_FLOW");

      for (const binding of saleFlow) {
        expect(binding.context).toBe("SALE_FLOW");
      }
    });
  });

  describe("getBindingsForContexts", () => {
    it("returns bindings matching any of the given contexts", () => {
      const result = manager.getBindingsForContexts(["GLOBAL", "SALE_FLOW"]);
      const contexts = new Set(result.map((b) => b.context));

      expect(contexts.has("GLOBAL")).toBe(true);
      expect(contexts.has("SALE_FLOW")).toBe(true);
      expect(contexts.has("MANAGER_ONLY")).toBe(false);
    });
  });

  describe("findBindingByKey", () => {
    it("finds an existing binding by key", () => {
      const binding = manager.findBindingByKey("Cmd+N");
      expect(binding).toBeDefined();
      expect(binding!.commandId).toBe("cmd.new-sale");
    });

    it("returns null for an unregistered key", () => {
      const binding = manager.findBindingByKey("Alt+X");
      expect(binding).toBeNull();
    });
  });

  describe("findBindingByCommandId", () => {
    it("finds an existing binding by command id", () => {
      const binding = manager.findBindingByCommandId("cmd.sync-now");
      expect(binding).toBeDefined();
      expect(binding!.key).toBe("Cmd+Shift+S");
    });

    it("returns null for an unknown command", () => {
      const binding = manager.findBindingByCommandId("cmd.unknown");
      expect(binding).toBeNull();
    });
  });

  describe("registerCustomBinding", () => {
    it("registers a new custom binding", () => {
      manager.registerCustomBinding("cmd.my-command", "Alt+1", "GLOBAL");

      const binding = manager.findBindingByKey("Alt+1");
      expect(binding).toBeDefined();
      expect(binding!.commandId).toBe("cmd.my-command");
    });

    it("throws ShortcutConflictException when a key is already used for another command", () => {
      expect(() => {
        manager.registerCustomBinding("cmd.other", "Cmd+K", "GLOBAL");
      }).toThrow(ShortcutConflictException);
    });

    it("allows re-registering the same command with a different key (replaces)", () => {
      manager.registerCustomBinding("cmd.new-sale", "Alt+N", "SALE_FLOW");

      const binding = manager.findBindingByKey("Alt+N");
      expect(binding).toBeDefined();
      expect(binding!.commandId).toBe("cmd.new-sale");
    });
  });

  describe("normalizeEvent", () => {
    function createKeyEvent(options: Partial<KeyboardEvent>): KeyboardEvent {
      return {
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        key: "",
        ...options,
      } as KeyboardEvent;
    }

    it("normalizes Cmd+K", () => {
      const event = createKeyEvent({ metaKey: true, key: "k" });
      expect(manager.normalizeEvent(event)).toBe("Cmd+K");
    });

    it("normalizes Ctrl+Shift+S", () => {
      const event = createKeyEvent({ ctrlKey: true, shiftKey: true, key: "s" });
      expect(manager.normalizeEvent(event)).toBe("Ctrl+Shift+S");
    });

    it("normalizes F1", () => {
      const event = createKeyEvent({ key: "F1" });
      expect(manager.normalizeEvent(event)).toBe("F1");
    });

    it("normalizes Escape", () => {
      const event = createKeyEvent({ key: "Escape" });
      expect(manager.normalizeEvent(event)).toBe("Escape");
    });

    it("normalizes Space", () => {
      const event = createKeyEvent({ key: " " });
      expect(manager.normalizeEvent(event)).toBe("Space");
    });

    it("returns empty string for modifier-only presses", () => {
      const event = createKeyEvent({ metaKey: true, key: "Meta" });
      expect(manager.normalizeEvent(event)).toBe("");
    });

    it("normalizes ?", () => {
      const event = createKeyEvent({ shiftKey: true, key: "?" });
      expect(manager.normalizeEvent(event)).toBe("Shift+?");
    });
  });

  describe("shouldSuppress", () => {
    function createKeyEvent(options: Partial<KeyboardEvent>): KeyboardEvent {
      return {
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        key: "",
        isComposing: false,
        target: null,
        ...options,
      } as KeyboardEvent;
    }

    it("does not suppress Escape", () => {
      const event = createKeyEvent({ key: "Escape" });
      expect(manager.shouldSuppress(event, true)).toBe(false);
    });

    it("does not suppress Cmd+K even in text input", () => {
      const input = document.createElement("input");
      const event = createKeyEvent({ metaKey: true, key: "k", target: input });
      expect(manager.shouldSuppress(event, false)).toBe(false);
    });

    it("suppresses non-global shortcuts in text input", () => {
      const input = document.createElement("input");
      const event = createKeyEvent({ metaKey: true, key: "n", target: input });
      expect(manager.shouldSuppress(event, false)).toBe(true);
    });

    it("suppresses when IME is composing", () => {
      const event = createKeyEvent({ key: "Enter", isComposing: true });
      expect(manager.shouldSuppress(event, false)).toBe(true);
    });

    it("does not suppress global shortcuts outside text input", () => {
      const event = createKeyEvent({ metaKey: true, key: "s", target: document.body });
      expect(manager.shouldSuppress(event, false)).toBe(false);
    });
  });

  describe("isGlobalShortcut", () => {
    it("returns true for GLOBAL context shortcuts", () => {
      expect(manager.isGlobalShortcut("shortcut.palette")).toBe(true);
    });

    it("returns false for non-GLOBAL shortcuts", () => {
      expect(manager.isGlobalShortcut("shortcut.new-sale")).toBe(false);
    });

    it("returns false for unknown shortcut ids", () => {
      expect(manager.isGlobalShortcut("shortcut.unknown")).toBe(false);
    });
  });

  describe("applyUserOverrides", () => {
    it("updates shortcuts from user preferences", () => {
      manager.applyUserOverrides({
        customShortcuts: { "cmd.new-sale": "Alt+N" },
      });

      const binding = manager.findBindingByKey("Alt+N");
      expect(binding).toBeDefined();
      expect(binding!.commandId).toBe("cmd.new-sale");
    });

    it("removes old key binding when shortcut is overridden", () => {
      manager.applyUserOverrides({
        customShortcuts: { "cmd.new-sale": "Alt+N" },
      });

      const oldBinding = manager.findBindingByKey("Cmd+N");
      expect(oldBinding).toBeNull();
    });

    it("handles empty overrides gracefully", () => {
      manager.applyUserOverrides({ customShortcuts: {} });

      expect(manager.getBindings().length).toBeGreaterThanOrEqual(8);
    });
  });
});
