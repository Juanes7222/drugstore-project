/**
 * Component tests for SuggestionBanner.
 *
 * Covers: rendering suggestions, expand/collapse, dismiss individual
 * suggestion, empty state.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuggestionBanner } from "./suggestion-banner";
import type { ActiveSuggestion } from "../../../domain/assistant/assistant-types";
import "@/i18n";

// ---------------------------------------------------------------------------
// Mocks - mutable so we can set per-test values
// ---------------------------------------------------------------------------

const mockAssistantStore = vi.fn();
const mockUserPrefsStore = vi.fn();

vi.mock("../../../stores/assistant.store", () => ({
  useAssistantStore: (selector: unknown) =>
    mockAssistantStore(selector),
}));

vi.mock("../../../stores/user-preferences.store", () => ({
  useUserPreferencesStore: (selector: unknown) =>
    mockUserPrefsStore(selector),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createSuggestion = (
  overrides: Partial<ActiveSuggestion> = {},
): ActiveSuggestion => ({
  ruleId: "suggestion.warn.sync-stale",
  severity: "WARN",
  title: "Sincronización atrasada",
  description: "Hay cambios sin sincronizar desde hace más de 5 minutos.",
  dismissable: true,
  action: {
    label: "Sincronizar ahora",
    execute: vi.fn(),
  },
  ...overrides,
});

const stubAssistantStore = (overrides: Record<string, unknown> = {}) => {
  const defaults = {
    suggestions: [] as ActiveSuggestion[],
    suggestionsExpanded: false,
    setSuggestionsExpanded: vi.fn(),
  };
  mockAssistantStore.mockImplementation((selector: (s: typeof defaults) => unknown) =>
    selector({ ...defaults, ...overrides }),
  );
};

const stubUserPrefsStore = (overrides: Record<string, unknown> = {}) => {
  const defaults = {
    dismissSuggestion: vi.fn(),
  };
  mockUserPrefsStore.mockImplementation((selector: (s: typeof defaults) => unknown) =>
    selector({ ...defaults, ...overrides }),
  );
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SuggestionBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubAssistantStore();
    stubUserPrefsStore();
  });

  it("renders suggestions", () => {
    stubAssistantStore({ suggestions: [createSuggestion()] });
    render(<SuggestionBanner />);

    expect(screen.getByText("Sincronización atrasada")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Hay cambios sin sincronizar desde hace más de 5 minutos.",
      ),
    ).toBeInTheDocument();
  });

  it("shows nothing when there are no suggestions", () => {
    stubAssistantStore({ suggestions: [] });
    const { container } = render(<SuggestionBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("does not show dismiss button for non-dismissable CRITICAL suggestions", () => {
    stubAssistantStore({
      suggestions: [
        createSuggestion({ severity: "CRITICAL", dismissable: false }),
      ],
    });
    render(<SuggestionBanner />);

    expect(screen.queryByRole("button", { name: /Cerrar/ })).not.toBeInTheDocument();
  });

  it("shows dismiss button for dismissable suggestions", () => {
    stubAssistantStore({
      suggestions: [createSuggestion({ dismissable: true })],
    });
    render(<SuggestionBanner />);

    expect(screen.getAllByRole("button", { name: /Cerrar/ }).length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("calls dismissSuggestion when dismiss button clicked", () => {
    const dismissSuggestion = vi.fn();
    stubUserPrefsStore({ dismissSuggestion });
    stubAssistantStore({
      suggestions: [createSuggestion({ dismissable: true })],
    });

    render(<SuggestionBanner />);

    const dismissButtons = screen.getAllByRole("button", { name: /Cerrar/ });
    fireEvent.click(dismissButtons[0]);

    expect(dismissSuggestion).toHaveBeenCalledWith(
      "suggestion.warn.sync-stale",
    );
  });

  it("shows expand toggle when more than 3 non-critical suggestions", () => {
    const suggestions = Array.from({ length: 5 }, (_, i) =>
      createSuggestion({
        ruleId: `suggestion.${i}`,
        title: `Suggestion ${i + 1}`,
      }),
    );
    stubAssistantStore({ suggestions, suggestionsExpanded: false });

    render(<SuggestionBanner />);

    // The expand toggle button shows "+2 más"
    expect(
      screen.getByRole("button", { name: /más/ }),
    ).toBeInTheDocument();
  });

  it("calls execute when action button clicked", () => {
    const execute = vi.fn();
    stubAssistantStore({
      suggestions: [
        createSuggestion({
          ruleId: "suggestion.test",
          action: { label: "Ejecutar", execute },
        }),
      ],
    });

    render(<SuggestionBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Ejecutar" }));
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
