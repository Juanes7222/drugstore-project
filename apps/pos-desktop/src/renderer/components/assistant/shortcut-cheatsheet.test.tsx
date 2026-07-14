/**
 * Component tests for ShortcutCheatsheet overlay.
 *
 * The heavy logic lives in useShortcutCheatsheet (tested separately);
 * this spec verifies the wiring: open/closed states, child rendering,
 * conflict warning visibility, and search filtering.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShortcutCheatsheet } from "./shortcut-cheatsheet";

// ---------------------------------------------------------------------------
// Mock the hook
// ---------------------------------------------------------------------------

const createMockReturn = (overrides?: Record<string, unknown>) => ({
  cheatsheetOpen: false,
  searchQuery: "",
  setSearchQuery: vi.fn(),
  capturingId: null,
  conflictDescription: null,
  groupedBindings: [],
  inputRef: { current: null },
  isCustom: vi.fn(),
  defaultKeyForCommand: vi.fn(),
  startCapture: vi.fn(),
  cancelCapture: vi.fn(),
  restoreDefault: vi.fn(),
  handleSearchChange: vi.fn(),
  handleOpenChange: vi.fn(),
  filteredBindings: [],
  ...overrides,
});

let mockHookReturn: ReturnType<typeof createMockReturn>;

vi.mock("../../hooks/use-shortcut-cheatsheet", () => ({
  useShortcutCheatsheet: () => mockHookReturn,
}));

// ---------------------------------------------------------------------------
// Mock child components for simple rendering verification
// ---------------------------------------------------------------------------

vi.mock("./shortcut-header", () => ({
  ShortcutHeader: ({ onClose }: Record<string, unknown>) => (
    <div data-testid="shortcut-header" />
  ),
}));

vi.mock("./shortcut-search-input", () => ({
  ShortcutSearchInput: (props: Record<string, unknown>) => (
    <div data-testid="shortcut-search-input" />
  ),
}));

vi.mock("./shortcut-group", () => ({
  ShortcutGroup: (props: Record<string, unknown>) => (
    <div data-testid="shortcut-group" />
  ),
}));

vi.mock("./shortcut-footer", () => ({
  ShortcutFooter: () => <div data-testid="shortcut-footer" />,
}));

vi.mock("./shortcut-states", () => ({
  ShortcutConflictWarning: ({
    commandDescription,
  }: Record<string, unknown>) => (
    <div data-testid="shortcut-conflict-warning" />
  ),
  ShortcutEmptySearch: ({ query }: Record<string, unknown>) => (
    <div data-testid="shortcut-empty-search" />
  ),
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ShortcutCheatsheet", () => {
  beforeEach(() => {
    mockHookReturn = createMockReturn();
    vi.clearAllMocks();
  });

  // ── Closed state ─────────────────────────────────────────────────────

  it("does not render children when cheatsheet is closed", () => {
    mockHookReturn.cheatsheetOpen = false;

    const { container } = render(<ShortcutCheatsheet />);

    expect(
      screen.queryByTestId("shortcut-header"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("shortcut-footer"),
    ).not.toBeInTheDocument();
  });

  // ── Open state ───────────────────────────────────────────────────────

  it("renders all child sections when cheatsheet is open", () => {
    mockHookReturn.cheatsheetOpen = true;
    mockHookReturn.groupedBindings = [
      {
        context: "Ventas",
        bindings: [
          { id: "s1", keys: "Ctrl+N", description: "Nueva venta" },
        ],
      },
    ];

    render(<ShortcutCheatsheet />);

    expect(screen.getByTestId("shortcut-header")).toBeInTheDocument();
    expect(
      screen.getByTestId("shortcut-search-input"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("shortcut-group")).toBeInTheDocument();
    expect(screen.getByTestId("shortcut-footer")).toBeInTheDocument();
  });

  // ── Conflict warning ─────────────────────────────────────────────────

  it("renders conflict warning when conflictDescription is set", () => {
    mockHookReturn.cheatsheetOpen = true;
    mockHookReturn.conflictDescription = "Ctrl+S ya está asignado";

    render(<ShortcutCheatsheet />);

    expect(
      screen.getByTestId("shortcut-conflict-warning"),
    ).toBeInTheDocument();
  });

  it("does not render conflict warning when conflictDescription is null", () => {
    mockHookReturn.cheatsheetOpen = true;
    mockHookReturn.conflictDescription = null;

    render(<ShortcutCheatsheet />);

    expect(
      screen.queryByTestId("shortcut-conflict-warning"),
    ).not.toBeInTheDocument();
  });

  // ── Empty search ─────────────────────────────────────────────────────

  it("renders empty search state when search has no results", () => {
    mockHookReturn.cheatsheetOpen = true;
    mockHookReturn.searchQuery = "unknown";
    mockHookReturn.filteredBindings = [];

    render(<ShortcutCheatsheet />);

    expect(
      screen.getByTestId("shortcut-empty-search"),
    ).toBeInTheDocument();
  });

  it("does not render empty search when query is empty", () => {
    mockHookReturn.cheatsheetOpen = true;
    mockHookReturn.searchQuery = "";

    render(<ShortcutCheatsheet />);

    expect(
      screen.queryByTestId("shortcut-empty-search"),
    ).not.toBeInTheDocument();
  });

  it("does not render empty search when there are results", () => {
    mockHookReturn.cheatsheetOpen = true;
    mockHookReturn.searchQuery = "Venta";
    mockHookReturn.filteredBindings = [
      { id: "s1", keys: "Ctrl+N", description: "Nueva venta" },
    ];

    render(<ShortcutCheatsheet />);

    expect(
      screen.queryByTestId("shortcut-empty-search"),
    ).not.toBeInTheDocument();
  });

  // ── Capture mode ─────────────────────────────────────────────────────

  it("disables search input when capturing key binding", () => {
    mockHookReturn.cheatsheetOpen = true;
    mockHookReturn.capturingId = "s1";

    render(<ShortcutCheatsheet />);

    expect(
      screen.getByTestId("shortcut-search-input"),
    ).toBeInTheDocument();
  });
});
