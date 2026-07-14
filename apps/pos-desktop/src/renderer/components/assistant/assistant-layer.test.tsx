/**
 * Component tests for AssistantLayer — the singleton overlay orchestrator.
 *
 * Mounts all assistant overlays (CommandPalette, SuggestionBanner,
 * ShortcutCheatsheet, HelpViewer) and wires global keyboard shortcuts.
 *
 * Because the component uses dynamic imports inside useEffects, the real
 * async behavior is tested via the hook unit tests; here we verify the
 * render output and child component wiring.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssistantLayer } from "./assistant-layer";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAssistantStore } = vi.hoisted(() => ({
  mockAssistantStore: {
    paletteOpen: false,
    cheatsheetOpen: false,
    helpOpen: false,
    preferencesOpen: false,
    openPalette: vi.fn(),
    closeAll: vi.fn(),
    openHelp: vi.fn(),
    openCheatsheet: vi.fn(),
    setIsIndexBuilding: vi.fn(),
    setSuggestions: vi.fn(),
  },
}));

const { mockSessionStore } = vi.hoisted(() => ({
  mockSessionStore: { session: null },
}));

const mockUseGlobalShortcuts = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------

vi.mock("../../store/hooks", () => ({
  useAppSelector: (selector: unknown) => (selector as any)({ ui: { activeScreen: "sales" } }),
}));

vi.mock("../../store/slices/ui-slice", () => ({
  selectActiveScreen: (state: any) => state.ui.activeScreen,
  resetSaleFlow: vi.fn(),
  navigateBackToSales: vi.fn(),
}));

vi.mock("../../../domain/auth/local-session.store", () => ({
  useLocalSessionStore: (
    selector: (s: { session: unknown }) => unknown,
  ) => selector(mockSessionStore),
}));

vi.mock("../../../stores/assistant.store", () => ({
  useAssistantStore: (
    selector: (s: Record<string, unknown>) => unknown,
  ) => selector(mockAssistantStore),
}));

// ---------------------------------------------------------------------------
// Hook mocks
// ---------------------------------------------------------------------------

vi.mock("../../hooks/use-global-shortcuts", () => ({
  useGlobalShortcuts: (...args: unknown[]) =>
    mockUseGlobalShortcuts(...args),
}));

vi.mock("../../hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

// ---------------------------------------------------------------------------
// Mock child components
// ---------------------------------------------------------------------------

vi.mock("./command-palette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));

vi.mock("./suggestion-banner", () => ({
  SuggestionBanner: () => <div data-testid="suggestion-banner" />,
}));

vi.mock("./shortcut-cheatsheet", () => ({
  ShortcutCheatsheet: () => (
    <div data-testid="shortcut-cheatsheet" />
  ),
}));

vi.mock("./help-viewer", () => ({
  HelpViewer: () => <div data-testid="help-viewer" />,
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AssistantLayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionStore.session = null;
  });

  // ── Render all children ──────────────────────────────────────────────

  it("renders all four child overlays", () => {
    render(<AssistantLayer />);

    expect(
      screen.getByTestId("command-palette"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("suggestion-banner"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("shortcut-cheatsheet"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("help-viewer")).toBeInTheDocument();
  });

  // ── Global shortcuts ─────────────────────────────────────────────────

  it("registers global shortcuts with the correct handlers", () => {
    render(<AssistantLayer />);

    expect(mockUseGlobalShortcuts).toHaveBeenCalledTimes(1);
    const args = mockUseGlobalShortcuts.mock.calls[0];
    expect(args[0]).toHaveProperty("onOpenPalette");
    expect(args[0]).toHaveProperty("onOpenHelp");
    expect(args[0]).toHaveProperty("onShowCheatsheet");
    expect(args[0]).toHaveProperty("onCloseOverlay");
    expect(args[0]).toHaveProperty("onNewSale");
    expect(args[0]).toHaveProperty("onSyncNow");
    expect(args[0]).toHaveProperty("onContextHelp");
    // Second arg: isModalOpen
    expect(args[1]).toBe(false);
    // Third arg: activeScreen
    expect(args[2]).toBe("sales");
  });

  it("passes isModalOpen=true when any overlay is open", () => {
    mockAssistantStore.paletteOpen = true;

    render(<AssistantLayer />);

    expect(mockUseGlobalShortcuts).toHaveBeenCalled();
    const args = mockUseGlobalShortcuts.mock.calls[0];
    expect(args[1]).toBe(true);
  });

  it("passes isModalOpen=true when cheatsheet is open", () => {
    mockAssistantStore.cheatsheetOpen = true;

    render(<AssistantLayer />);

    expect(mockUseGlobalShortcuts).toHaveBeenCalled();
    const args = mockUseGlobalShortcuts.mock.calls[0];
    expect(args[1]).toBe(true);
  });

  it("passes isModalOpen=true when help viewer is open", () => {
    mockAssistantStore.helpOpen = true;

    render(<AssistantLayer />);

    expect(mockUseGlobalShortcuts).toHaveBeenCalled();
    const args = mockUseGlobalShortcuts.mock.calls[0];
    expect(args[1]).toBe(true);
  });

  // ── Session role ─────────────────────────────────────────────────────

  it("handles null session gracefully", () => {
    mockSessionStore.session = null;

    render(<AssistantLayer />);

    // Should not crash
    expect(
      screen.getByTestId("command-palette"),
    ).toBeInTheDocument();
  });

  it("handles active session with role", () => {
    mockSessionStore.session = {
      userId: "user-1",
      username: "test",
      fullName: "Test User",
      displayName: "Test User",
      email: null,
      role: "CASHIER",
      subscriptionId: null,
      workstationId: "ws-1",
      accessToken: "token-123",
      refreshToken: "refresh-123",
      expiresAt: new Date("2099-01-01"),
      sessionId: "session-1",
      totpEnabled: false,
      avatarUrl: null,
      avatarColor: null,
      mustChangePassword: false,
    };

    render(<AssistantLayer />);

    // Should not crash
    expect(
      screen.getByTestId("command-palette"),
    ).toBeInTheDocument();
  });
});
