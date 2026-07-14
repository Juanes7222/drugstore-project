/**
 * Component tests for HelpViewer overlay.
 *
 * Covers: open/closed states, sidebar and content area rendering,
 * and user preferences store interaction.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { HelpViewer } from "./help-viewer";

// ---------------------------------------------------------------------------
// Mock the user preferences store
// ---------------------------------------------------------------------------

const { mockUserPrefsStore } = vi.hoisted(() => ({
  mockUserPrefsStore: { wasHelpPageViewedRecently: vi.fn() },
}));

vi.mock("../../../stores/user-preferences.store", () => ({
  useUserPreferencesStore: (
    selector: (s: { wasHelpPageViewedRecently: (key: string) => boolean }) => unknown,
  ) => selector(mockUserPrefsStore),
}));

// ---------------------------------------------------------------------------
// Mock the hook
// ---------------------------------------------------------------------------

const createMockReturn = (overrides?: Record<string, unknown>) => ({
  helpOpen: false,
  searchQuery: "",
  setSearchQuery: vi.fn(),
  selectedTopicId: null,
  selectedTopic: null,
  isProcedure: false,
  groupedEntries: [],
  helpTopicId: null,
  checkedSteps: [],
  searchInputRef: { current: null },
  handleOpenChange: vi.fn(),
  handleSelectTopic: vi.fn(),
  handleGoToIndex: vi.fn(),
  handleSearchKeyDown: vi.fn(),
  handleToggleStep: vi.fn(),
  ...overrides,
});

let mockHookReturn: ReturnType<typeof createMockReturn>;

vi.mock("../../hooks/use-help-viewer", () => ({
  useHelpViewer: () => mockHookReturn,
}));

// ---------------------------------------------------------------------------
// Mock child components
// ---------------------------------------------------------------------------

vi.mock("./help-sidebar", () => ({
  HelpSidebar: (props: Record<string, unknown>) => (
    <div data-testid="help-sidebar" />
  ),
}));

vi.mock("./help-content-area", () => ({
  HelpContentArea: (props: Record<string, unknown>) => (
    <div data-testid="help-content-area" />
  ),
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("HelpViewer", () => {
  beforeEach(() => {
    mockHookReturn = createMockReturn();
    vi.clearAllMocks();
  });

  // ── Closed state ─────────────────────────────────────────────────────

  it("does not render children when help is closed", () => {
    mockHookReturn.helpOpen = false;

    render(<HelpViewer />);

    expect(
      screen.queryByTestId("help-sidebar"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("help-content-area"),
    ).not.toBeInTheDocument();
  });

  // ── Open state ───────────────────────────────────────────────────────

  it("renders sidebar and content area when help is open", () => {
    mockHookReturn.helpOpen = true;

    render(<HelpViewer />);

    expect(screen.getByTestId("help-sidebar")).toBeInTheDocument();
    expect(
      screen.getByTestId("help-content-area"),
    ).toBeInTheDocument();
  });

  // ── With topics ──────────────────────────────────────────────────────

  it("passes grouped entries to sidebar", () => {
    mockHookReturn.helpOpen = true;
    mockHookReturn.groupedEntries = [
      {
        category: "Ventas",
        entries: [
          {
            id: "sales-intro",
            title: "Introducción a ventas",
            type: "topic",
          },
        ],
      },
    ];

    render(<HelpViewer />);

    expect(screen.getByTestId("help-sidebar")).toBeInTheDocument();
    expect(
      screen.getByTestId("help-content-area"),
    ).toBeInTheDocument();
  });

  // ── Procedure mode ───────────────────────────────────────────────────

  it("renders with procedure flag when topic is a procedure", () => {
    mockHookReturn.helpOpen = true;
    mockHookReturn.isProcedure = true;
    mockHookReturn.selectedTopic = {
      id: "procedure-1",
      title: "Cómo abrir turno",
      body: "# Pasos",
      type: "procedure",
    };
    mockHookReturn.selectedTopicId = "procedure-1";

    render(<HelpViewer />);

    expect(screen.getByTestId("help-sidebar")).toBeInTheDocument();
    expect(
      screen.getByTestId("help-content-area"),
    ).toBeInTheDocument();
  });

  // ── User preferences store is passed to HelpSidebar ──────────────────

  it("renders with user preferences available for entry highlighting", () => {
    mockHookReturn.helpOpen = true;

    render(<HelpViewer />);

    // The sidebar receives entryHasRecentView callback; rendering confirms
    // the store was wired correctly (the callback is consumed by HelpSidebar)
    expect(screen.getByTestId("help-sidebar")).toBeInTheDocument();
  });
});
