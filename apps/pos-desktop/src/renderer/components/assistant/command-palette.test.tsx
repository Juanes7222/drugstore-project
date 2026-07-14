/**
 * Component tests for CommandPalette overlay.
 *
 * Covers: open/closed states, index building, search error, empty
 * results, welcome state, and results rendering.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommandPalette } from "./command-palette";

// ---------------------------------------------------------------------------
// Mock the assistant store — the component reads paletteOpen from it directly
// ---------------------------------------------------------------------------

const { mockAssistantStore } = vi.hoisted(() => ({
  mockAssistantStore: { paletteOpen: false },
}));

vi.mock("../../../stores/assistant.store", () => ({
  useAssistantStore: (
    selector: (s: { paletteOpen: boolean }) => unknown,
  ) => selector(mockAssistantStore),
}));

// ---------------------------------------------------------------------------
// Mock the hook
// ---------------------------------------------------------------------------

const createMockReturn = (overrides?: Record<string, unknown>) => ({
  query: "",
  selectedIndex: 0,
  groupedResults: [],
  flatItems: [],
  isIndexBuilding: false,
  inputRef: { current: null },
  listRef: { current: null },
  searchError: null,
  handleInputChange: vi.fn(),
  handleOpenChange: vi.fn(),
  handleKeyDown: vi.fn(),
  executeItem: vi.fn(),
  ...overrides,
});

let mockHookReturn: ReturnType<typeof createMockReturn>;

vi.mock("../../hooks/use-command-palette", () => ({
  useCommandPalette: () => mockHookReturn,
}));

// ---------------------------------------------------------------------------
// Mock child components
// ---------------------------------------------------------------------------

vi.mock("./palette-search-input", () => ({
  PaletteSearchInput: (props: Record<string, unknown>) => (
    <div data-testid="palette-search-input" />
  ),
}));

vi.mock("./palette-search-result-group", () => ({
  PaletteSearchResultGroup: (props: Record<string, unknown>) => (
    <div data-testid="palette-search-result-group" />
  ),
}));

vi.mock("./palette-footer", () => ({
  PaletteFooter: () => <div data-testid="palette-footer" />,
}));

vi.mock("./palette-states", () => ({
  PaletteEmptyResults: ({ query }: Record<string, unknown>) => (
    <div data-testid="palette-empty-results" />
  ),
  PaletteIndexBuilding: () => (
    <div data-testid="palette-index-building" />
  ),
  PaletteSearchError: ({ message }: Record<string, unknown>) => (
    <div data-testid="palette-search-error" />
  ),
  PaletteWelcomeState: () => (
    <div data-testid="palette-welcome-state" />
  ),
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("CommandPalette", () => {
  beforeEach(() => {
    mockAssistantStore.paletteOpen = false;
    mockHookReturn = createMockReturn();
    vi.clearAllMocks();
  });

  // ── Closed state ─────────────────────────────────────────────────────

  it("does not render children when palette is closed", () => {
    render(<CommandPalette />);

    expect(
      screen.queryByTestId("palette-search-input"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("palette-footer"),
    ).not.toBeInTheDocument();
  });

  // ── Open state ───────────────────────────────────────────────────────

  it("renders search input and footer when palette is open", () => {
    mockAssistantStore.paletteOpen = true;

    render(<CommandPalette />);

    expect(
      screen.getByTestId("palette-search-input"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("palette-footer")).toBeInTheDocument();
  });

  // ── Index building ───────────────────────────────────────────────────

  it("renders index building indicator when building", () => {
    mockAssistantStore.paletteOpen = true;
    mockHookReturn.isIndexBuilding = true;

    render(<CommandPalette />);

    expect(
      screen.getByTestId("palette-index-building"),
    ).toBeInTheDocument();
  });

  it("does not render other states when index is building", () => {
    mockAssistantStore.paletteOpen = true;
    mockHookReturn.isIndexBuilding = true;
    mockHookReturn.searchError = "error";

    render(<CommandPalette />);

    expect(
      screen.getByTestId("palette-index-building"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("palette-search-error"),
    ).not.toBeInTheDocument();
  });

  // ── Search error ─────────────────────────────────────────────────────

  it("renders search error when searchError is set", () => {
    mockAssistantStore.paletteOpen = true;
    mockHookReturn.searchError = "Connection failed";

    render(<CommandPalette />);

    expect(
      screen.getByTestId("palette-search-error"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("palette-index-building"),
    ).not.toBeInTheDocument();
  });

  // ── Empty results ────────────────────────────────────────────────────

  it("renders empty results when query has no matches", () => {
    mockAssistantStore.paletteOpen = true;
    mockHookReturn.query = "xyz";
    mockHookReturn.flatItems = [];

    render(<CommandPalette />);

    expect(
      screen.getByTestId("palette-empty-results"),
    ).toBeInTheDocument();
  });

  it("renders welcome state when query is empty and no results", () => {
    mockAssistantStore.paletteOpen = true;
    mockHookReturn.query = "";
    mockHookReturn.flatItems = [];

    render(<CommandPalette />);

    expect(
      screen.getByTestId("palette-welcome-state"),
    ).toBeInTheDocument();
  });

  // ── Results ──────────────────────────────────────────────────────────

  it("renders result groups when there are flat items", () => {
    mockAssistantStore.paletteOpen = true;
    mockHookReturn.flatItems = [
      { id: "nav-sales", label: "Ir a Ventas" },
    ];
    mockHookReturn.groupedResults = [
      {
        category: "navigation",
        labelKey: "Navegación",
        items: [
          { id: "nav-sales", label: "Ir a Ventas" },
        ],
      },
    ];

    render(<CommandPalette />);

    expect(
      screen.getByTestId("palette-search-result-group"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("palette-welcome-state"),
    ).not.toBeInTheDocument();
  });
});
