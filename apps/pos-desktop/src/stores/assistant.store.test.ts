/**
 * Tests for the assistant overlay Zustand store.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useAssistantStore } from "./assistant.store";
import type { ActiveSuggestion } from "../domain/assistant/assistant-types";

beforeEach(() => {
  useAssistantStore.setState({
    paletteOpen: false,
    paletteQuery: "",
    cheatsheetOpen: false,
    helpOpen: false,
    helpTopicId: null,
    preferencesOpen: false,
    suggestions: [],
    suggestionsExpanded: false,
    isIndexBuilding: false,
  });
});

describe("initial state", () => {
  it("all overlays are closed by default", () => {
    const state = useAssistantStore.getState();

    expect(state.paletteOpen).toBe(false);
    expect(state.cheatsheetOpen).toBe(false);
    expect(state.helpOpen).toBe(false);
    expect(state.preferencesOpen).toBe(false);
  });

  it("palette query starts empty", () => {
    expect(useAssistantStore.getState().paletteQuery).toBe("");
  });

  it("suggestions start empty", () => {
    expect(useAssistantStore.getState().suggestions).toEqual([]);
  });

  it("isIndexBuilding starts false", () => {
    expect(useAssistantStore.getState().isIndexBuilding).toBe(false);
  });
});

describe("openPalette", () => {
  it("opens the palette and closes other overlays", () => {
    useAssistantStore.getState().openPalette();

    const state = useAssistantStore.getState();
    expect(state.paletteOpen).toBe(true);
    expect(state.paletteQuery).toBe("");
    expect(state.cheatsheetOpen).toBe(false);
    expect(state.helpOpen).toBe(false);
    expect(state.preferencesOpen).toBe(false);
  });

  it("closes help viewer if it was open", () => {
    useAssistantStore.getState().openHelp("topic-1");
    useAssistantStore.getState().openPalette();

    expect(useAssistantStore.getState().helpOpen).toBe(false);
    // Note: openPalette does not reset helpTopicId; only closeHelp/closeAll do
  });
});

describe("closePalette", () => {
  it("closes the palette and resets query", () => {
    useAssistantStore.getState().openPalette();
    useAssistantStore.getState().setPaletteQuery("test");
    useAssistantStore.getState().closePalette();

    const state = useAssistantStore.getState();
    expect(state.paletteOpen).toBe(false);
    expect(state.paletteQuery).toBe("");
  });
});

describe("setPaletteQuery", () => {
  it("updates the palette query text", () => {
    useAssistantStore.getState().setPaletteQuery("acetaminofén");

    expect(useAssistantStore.getState().paletteQuery).toBe("acetaminofén");
  });

  it("can set query to empty string", () => {
    useAssistantStore.getState().setPaletteQuery("some text");
    useAssistantStore.getState().setPaletteQuery("");

    expect(useAssistantStore.getState().paletteQuery).toBe("");
  });
});

describe("openCheatsheet", () => {
  it("opens cheatsheet and closes other overlays", () => {
    useAssistantStore.getState().openPalette();
    useAssistantStore.getState().openCheatsheet();

    const state = useAssistantStore.getState();
    expect(state.cheatsheetOpen).toBe(true);
    expect(state.paletteOpen).toBe(false);
    expect(state.helpOpen).toBe(false);
    expect(state.preferencesOpen).toBe(false);
  });
});

describe("closeCheatsheet", () => {
  it("closes the cheatsheet", () => {
    useAssistantStore.getState().openCheatsheet();
    useAssistantStore.getState().closeCheatsheet();

    expect(useAssistantStore.getState().cheatsheetOpen).toBe(false);
  });
});

describe("openHelp", () => {
  it("opens help viewer with no specific topic", () => {
    useAssistantStore.getState().openHelp();

    const state = useAssistantStore.getState();
    expect(state.helpOpen).toBe(true);
    expect(state.helpTopicId).toBeNull();
  });

  it("opens help viewer with a specific topic", () => {
    useAssistantStore.getState().openHelp("topic-how-to-sell");

    expect(useAssistantStore.getState().helpTopicId).toBe("topic-how-to-sell");
  });

  it("closes other overlays when opening help", () => {
    useAssistantStore.getState().openPalette();
    useAssistantStore.getState().openHelp();

    expect(useAssistantStore.getState().helpOpen).toBe(true);
    expect(useAssistantStore.getState().paletteOpen).toBe(false);
  });
});

describe("closeHelp", () => {
  it("closes help viewer and clears topic", () => {
    useAssistantStore.getState().openHelp("topic-1");
    useAssistantStore.getState().closeHelp();

    const state = useAssistantStore.getState();
    expect(state.helpOpen).toBe(false);
    expect(state.helpTopicId).toBeNull();
  });
});

describe("openPreferences", () => {
  it("opens preferences and closes other overlays", () => {
    useAssistantStore.getState().openHelp();
    useAssistantStore.getState().openPreferences();

    const state = useAssistantStore.getState();
    expect(state.preferencesOpen).toBe(true);
    expect(state.helpOpen).toBe(false);
    expect(state.paletteOpen).toBe(false);
    expect(state.cheatsheetOpen).toBe(false);
  });
});

describe("closePreferences", () => {
  it("closes the preferences panel", () => {
    useAssistantStore.getState().openPreferences();
    useAssistantStore.getState().closePreferences();

    expect(useAssistantStore.getState().preferencesOpen).toBe(false);
  });
});

describe("setSuggestions", () => {
  it("replaces the suggestions array", () => {
    const suggestion: ActiveSuggestion = {
      ruleId: "suggestion.warn.sync-stale",
      title: "Test",
      description: "Test desc",
      severity: "WARN",
      dismissable: true,
      action: { label: "OK", execute: () => {} },
    };

    useAssistantStore.getState().setSuggestions([suggestion]);

    expect(useAssistantStore.getState().suggestions).toHaveLength(1);
    expect(useAssistantStore.getState().suggestions[0].ruleId).toBe("suggestion.warn.sync-stale");
  });

  it("can set suggestions to empty array", () => {
    useAssistantStore.getState().setSuggestions([]);

    expect(useAssistantStore.getState().suggestions).toEqual([]);
  });
});

describe("setSuggestionsExpanded", () => {
  it("expands the suggestion banner", () => {
    useAssistantStore.getState().setSuggestionsExpanded(true);

    expect(useAssistantStore.getState().suggestionsExpanded).toBe(true);
  });

  it("collapses the suggestion banner", () => {
    useAssistantStore.getState().setSuggestionsExpanded(true);
    useAssistantStore.getState().setSuggestionsExpanded(false);

    expect(useAssistantStore.getState().suggestionsExpanded).toBe(false);
  });
});

describe("setIsIndexBuilding", () => {
  it("sets building to true", () => {
    useAssistantStore.getState().setIsIndexBuilding(true);

    expect(useAssistantStore.getState().isIndexBuilding).toBe(true);
  });

  it("sets building to false", () => {
    useAssistantStore.getState().setIsIndexBuilding(true);
    useAssistantStore.getState().setIsIndexBuilding(false);

    expect(useAssistantStore.getState().isIndexBuilding).toBe(false);
  });
});

describe("closeAll", () => {
  it("closes all overlays and resets palette query", () => {
    useAssistantStore.getState().openPalette();
    useAssistantStore.getState().setPaletteQuery("search");
    useAssistantStore.getState().openHelp("topic-1");
    useAssistantStore.getState().closeAll();

    const state = useAssistantStore.getState();
    expect(state.paletteOpen).toBe(false);
    expect(state.paletteQuery).toBe("");
    expect(state.cheatsheetOpen).toBe(false);
    expect(state.helpOpen).toBe(false);
    expect(state.helpTopicId).toBeNull();
    expect(state.preferencesOpen).toBe(false);
  });
});

describe("mutual exclusion", () => {
  it("opening palette closes cheatsheet", () => {
    useAssistantStore.getState().openCheatsheet();
    useAssistantStore.getState().openPalette();

    expect(useAssistantStore.getState().cheatsheetOpen).toBe(false);
    expect(useAssistantStore.getState().paletteOpen).toBe(true);
  });

  it("opening help closes palette", () => {
    useAssistantStore.getState().openPalette();
    useAssistantStore.getState().openHelp();

    expect(useAssistantStore.getState().paletteOpen).toBe(false);
    expect(useAssistantStore.getState().helpOpen).toBe(true);
  });

  it("opening preferences closes help", () => {
    useAssistantStore.getState().openHelp("topic-1");
    useAssistantStore.getState().openPreferences();

    expect(useAssistantStore.getState().helpOpen).toBe(false);
    expect(useAssistantStore.getState().preferencesOpen).toBe(true);
  });
});
