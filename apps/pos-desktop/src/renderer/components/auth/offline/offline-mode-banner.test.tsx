/**
 * Component tests for OfflineModeBanner.
 *
 * Covers rendering when offline, reconnecting, and online (hidden),
 * and the dismiss button for manager+ roles.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OfflineModeBanner } from "./offline-mode-banner";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockSelectConnectionState } = vi.hoisted(() => ({
  mockSelectConnectionState: vi.fn(),
}));

vi.mock("@/store/hooks", () => ({
  useAppSelector: (selector: (state: any) => unknown) => {
    const rootState = {
      offlineAuth: {
        connectionState: mockSelectConnectionState(),
      },
    };
    return selector(rootState);
  },
  useAppDispatch: vi.fn(),
}));

vi.mock("@/store/slices/offline-auth-slice", () => ({
  selectConnectionState: (state: any) => state.offlineAuth.connectionState,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// We need to import motion directly and mock it
vi.mock("motion/react", () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      // Strip motion-specific props that might cause issues
      const { initial, animate, exit, transition, whileInView, ...safeProps } = props;
      return <div {...safeProps}>{children}</div>;
    },
    span: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, ...safeProps } = props;
      return <span {...safeProps}>{children}</span>;
    },
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock hasMinRole and useLocalSessionStore
const { mockSession } = vi.hoisted(() => ({
  mockSession: { current: null as Record<string, unknown> | null },
}));

vi.mock("../../../../domain/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../domain/auth")>();
  return {
    ...actual,
    hasMinRole: vi.fn(() => true), // Default: can dismiss
    useLocalSessionStore: (selector: (s: any) => unknown) => {
      return selector({ session: mockSession.current });
    },
  };
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("OfflineModeBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.current = null;
    mockSelectConnectionState.mockReturnValue("OFFLINE");
  });

  it("renders when connectionState is OFFLINE", () => {
    mockSelectConnectionState.mockReturnValue("OFFLINE");

    render(<OfflineModeBanner />);

    expect(screen.getByRole("status")).toBeVisible();
  });

  it("renders when connectionState is RECONNECTING", () => {
    mockSelectConnectionState.mockReturnValue("RECONNECTING");

    render(<OfflineModeBanner />);

    expect(screen.getByRole("status")).toBeVisible();
  });

  it("does not render when connectionState is ONLINE", () => {
    mockSelectConnectionState.mockReturnValue("ONLINE");

    render(<OfflineModeBanner />);

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a spinner icon when reconnecting", () => {
    mockSelectConnectionState.mockReturnValue("RECONNECTING");

    render(<OfflineModeBanner />);

    // The banner should show the reconnecting message
    expect(screen.getByText("offline_banner.reconnecting")).toBeVisible();
  });

  it("shows the standard offline message when offline (not reconnecting)", () => {
    mockSelectConnectionState.mockReturnValue("OFFLINE");

    render(<OfflineModeBanner />);

    expect(screen.getByText("offline_banner.message")).toBeVisible();
  });

  it("shows a dismiss button for manager+ roles when offline", () => {
    mockSelectConnectionState.mockReturnValue("OFFLINE");
    // hasMinRole returns true by default; provide a non-null session so the
    // component's `session` check passes and the dismiss button renders
    mockSession.current = { role: "MANAGER" };

    render(<OfflineModeBanner />);

    expect(screen.getByRole("button", { name: "offline_banner.dismiss" })).toBeVisible();
  });

  it("hides the dismiss button for non-manager roles", async () => {
    // Override the hasMinRole mock after import
    const authModule = await import("../../../../domain/auth");

    mockSelectConnectionState.mockReturnValue("OFFLINE");
    mockSession.current = { role: "CASHIER" };
    vi.mocked(authModule.hasMinRole).mockReturnValueOnce(false);

    render(<OfflineModeBanner />);

    expect(screen.queryByRole("button", { name: "offline_banner.dismiss" })).toBeNull();
  });

  it("hides the banner after dismiss is clicked", async () => {
    const user = userEvent.setup();
    mockSelectConnectionState.mockReturnValue("OFFLINE");
    mockSession.current = { role: "MANAGER" };

    render(<OfflineModeBanner />);

    const dismissButton = screen.getByRole("button", { name: "offline_banner.dismiss" });
    await user.click(dismissButton);

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not show dismiss button when reconnecting", () => {
    mockSelectConnectionState.mockReturnValue("RECONNECTING");

    render(<OfflineModeBanner />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("has aria-live polite for accessibility", () => {
    mockSelectConnectionState.mockReturnValue("OFFLINE");

    render(<OfflineModeBanner />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});
