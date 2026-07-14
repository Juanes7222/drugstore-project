/**
 * Tests for the user preferences Zustand store (persisted).
 */
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { useUserPreferencesStore } from "./user-preferences.store";

beforeEach(() => {
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
});

describe("initial state", () => {
  it("has empty dismissed suggestions", () => {
    expect(useUserPreferencesStore.getState().dismissedSuggestions).toEqual([]);
  });

  it("has empty dismissal counts", () => {
    expect(useUserPreferencesStore.getState().dismissalCounts).toEqual({});
  });

  it("has empty custom shortcuts", () => {
    expect(useUserPreferencesStore.getState().customShortcuts).toEqual({});
  });

  it("has empty palette recent items", () => {
    expect(useUserPreferencesStore.getState().paletteRecentItems).toEqual([]);
  });

  it("has empty help viewed pages", () => {
    expect(useUserPreferencesStore.getState().helpViewedPages).toEqual({});
  });

  it("has empty form memory opt-outs", () => {
    expect(useUserPreferencesStore.getState().formMemoryOptOuts).toEqual([]);
  });

  it("starts with zero usage counts", () => {
    const state = useUserPreferencesStore.getState();
    expect(state.paletteUsageCount).toBe(0);
    expect(state.shortcutUsageCount).toBe(0);
  });
});

describe("dismissSuggestion", () => {
  it("adds the suggestion to dismissed list", () => {
    useUserPreferencesStore.getState().dismissSuggestion("suggestion.warn.sync-stale");

    expect(useUserPreferencesStore.getState().dismissedSuggestions).toContain("suggestion.warn.sync-stale");
  });

  it("increments dismissal count", () => {
    useUserPreferencesStore.getState().dismissSuggestion("rule-1");
    useUserPreferencesStore.getState().dismissSuggestion("rule-1");

    expect(useUserPreferencesStore.getState().dismissalCounts["rule-1"]).toBe(2);
  });
});

describe("shouldShowSuggestion", () => {
  it("returns true when suggestion is not dismissed", () => {
    expect(useUserPreferencesStore.getState().shouldShowSuggestion("rule-1")).toBe(true);
  });

  it("returns false when suggestion is dismissed", () => {
    useUserPreferencesStore.getState().dismissSuggestion("rule-1");

    expect(useUserPreferencesStore.getState().shouldShowSuggestion("rule-1")).toBe(false);
  });
});

describe("setCustomShortcut", () => {
  it("stores a custom shortcut for a command", () => {
    useUserPreferencesStore.getState().setCustomShortcut("cmd.new-sale", "Alt+N");

    expect(useUserPreferencesStore.getState().customShortcuts["cmd.new-sale"]).toBe("Alt+N");
  });

  it("overwrites an existing custom shortcut", () => {
    useUserPreferencesStore.getState().setCustomShortcut("cmd.new-sale", "Alt+N");
    useUserPreferencesStore.getState().setCustomShortcut("cmd.new-sale", "Alt+Shift+N");

    expect(useUserPreferencesStore.getState().customShortcuts["cmd.new-sale"]).toBe("Alt+Shift+N");
  });
});

describe("removeCustomShortcut", () => {
  it("removes a custom shortcut", () => {
    useUserPreferencesStore.getState().setCustomShortcut("cmd.new-sale", "Alt+N");
    useUserPreferencesStore.getState().removeCustomShortcut("cmd.new-sale");

    expect(useUserPreferencesStore.getState().customShortcuts["cmd.new-sale"]).toBeUndefined();
  });

  it("does nothing when removing a non-existent shortcut", () => {
    useUserPreferencesStore.getState().removeCustomShortcut("cmd.nonexistent");

    expect(useUserPreferencesStore.getState().customShortcuts).toEqual({});
  });
});

describe("getCustomShortcut", () => {
  it("returns undefined when no override exists", () => {
    const result = useUserPreferencesStore.getState().getCustomShortcut("cmd.new-sale");

    expect(result).toBeUndefined();
  });

  it("returns the override when one exists", () => {
    useUserPreferencesStore.getState().setCustomShortcut("cmd.new-sale", "Alt+N");

    expect(useUserPreferencesStore.getState().getCustomShortcut("cmd.new-sale")).toBe("Alt+N");
  });
});

describe("addPaletteRecentItem", () => {
  it("adds an item to the front of the list", () => {
    useUserPreferencesStore.getState().addPaletteRecentItem("item-1");
    useUserPreferencesStore.getState().addPaletteRecentItem("item-2");

    expect(useUserPreferencesStore.getState().paletteRecentItems).toEqual(["item-2", "item-1"]);
  });

  it("deduplicates when adding an existing item", () => {
    useUserPreferencesStore.getState().addPaletteRecentItem("item-1");
    useUserPreferencesStore.getState().addPaletteRecentItem("item-2");
    useUserPreferencesStore.getState().addPaletteRecentItem("item-1");

    expect(useUserPreferencesStore.getState().paletteRecentItems).toEqual(["item-1", "item-2"]);
  });

  it("limits the list to 20 items", () => {
    for (let i = 0; i < 25; i++) {
      useUserPreferencesStore.getState().addPaletteRecentItem(`item-${i}`);
    }

    expect(useUserPreferencesStore.getState().paletteRecentItems).toHaveLength(20);
    expect(useUserPreferencesStore.getState().paletteRecentItems[0]).toBe("item-24");
  });
});

describe("getPaletteRecentItems", () => {
  it("returns the current list", () => {
    useUserPreferencesStore.getState().addPaletteRecentItem("item-1");

    expect(useUserPreferencesStore.getState().getPaletteRecentItems()).toEqual(["item-1"]);
  });
});

describe("recordHelpPageView / wasHelpPageViewedRecently", () => {
  it("records a help page view", () => {
    useUserPreferencesStore.getState().recordHelpPageView("/help/sales");

    expect(useUserPreferencesStore.getState().helpViewedPages["/help/sales"]).toBeGreaterThan(0);
  });

  it("returns true for recently viewed pages (within default 24h)", () => {
    useUserPreferencesStore.getState().recordHelpPageView("/help/sales");

    expect(useUserPreferencesStore.getState().wasHelpPageViewedRecently("/help/sales")).toBe(true);
  });

  it("returns false for pages never viewed", () => {
    expect(useUserPreferencesStore.getState().wasHelpPageViewedRecently("/help/unknown")).toBe(false);
  });

  it("returns false when the view is older than the specified window", () => {
    vi.useFakeTimers();
    useUserPreferencesStore.getState().recordHelpPageView("/help/sales");
    // Advance time so the view is stale relative to the 0ms window
    vi.advanceTimersByTime(1);
    expect(useUserPreferencesStore.getState().wasHelpPageViewedRecently("/help/sales", 0)).toBe(false);
    vi.useRealTimers();
  });
});

describe("optOutFormField / isFormFieldOptedOut", () => {
  it("opts out a form field", () => {
    useUserPreferencesStore.getState().optOutFormField("inventory-reason");

    expect(useUserPreferencesStore.getState().isFormFieldOptedOut("inventory-reason")).toBe(true);
  });

  it("returns false for fields not opted out", () => {
    expect(useUserPreferencesStore.getState().isFormFieldOptedOut("inventory-reason")).toBe(false);
  });

  it("does not duplicate opt-outs", () => {
    useUserPreferencesStore.getState().optOutFormField("field-1");
    useUserPreferencesStore.getState().optOutFormField("field-1");

    expect(useUserPreferencesStore.getState().formMemoryOptOuts).toEqual(["field-1"]);
  });
});

describe("incrementPaletteUsage", () => {
  it("increments palette usage count by 1", () => {
    useUserPreferencesStore.getState().incrementPaletteUsage();
    expect(useUserPreferencesStore.getState().paletteUsageCount).toBe(1);

    useUserPreferencesStore.getState().incrementPaletteUsage();
    expect(useUserPreferencesStore.getState().paletteUsageCount).toBe(2);
  });
});

describe("incrementShortcutUsage", () => {
  it("increments shortcut usage count by 1", () => {
    useUserPreferencesStore.getState().incrementShortcutUsage();
    expect(useUserPreferencesStore.getState().shortcutUsageCount).toBe(1);
  });
});
