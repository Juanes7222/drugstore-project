/**
 * Unit tests for LoginPage — the thin wiring container.
 *
 * Covers: all render paths (already-logged-in, 2FA, avatar grid,
 * manual input, selected-user credential, error banner) by mocking
 * the useLoginPage hook and all child components.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LoginPage } from "./login.page";
import { RoleType } from "@pharmacy/shared-types";
import type { LocalUserInfo } from "../../../domain/auth/local-users";
import type { AuthService } from "../../../domain/auth/auth.service";

// ---------------------------------------------------------------------------
// Hoisted mocks — use vi.hoisted so the ref is available before hoisted
// vi.mock calls.
// ---------------------------------------------------------------------------

const { mockSessionRef, mockCachedUsers } = vi.hoisted(() => {
  const mockSessionRef: { current: unknown } = { current: null };
  const mockCachedUsers: { current: Array<Record<string, unknown>> } = {
    current: [
      {
        id: "owner-1",
        displayName: "Administrador del Sistema",
        role: "OWNER",
        avatarUrl: null,
        avatarColor: "#1E40AF",
        username: "admin",
      },
      {
        id: "cashier-1",
        displayName: "María Rodríguez",
        role: "CASHIER",
        avatarUrl: null,
        avatarColor: "#7C3AED",
        username: "cashier1",
      },
    ],
  };
  return { mockSessionRef, mockCachedUsers };
});

// ---------------------------------------------------------------------------
// Mock the local session store — the component reads it directly.
// ---------------------------------------------------------------------------

vi.mock("../../../domain/auth/local-session.store", () => ({
  useLocalSessionStore: (
    selector: (s: { session: unknown }) => unknown,
  ) => selector({ session: mockSessionRef.current }),
}));

// ---------------------------------------------------------------------------
// Mock loadCachedUsers — the component calls it in a useEffect on mount.
// Without this mock the promise never resolves in the test environment,
// leaving cachedUsers === null and rendering "Cargando..." instead of
// the avatar grid or manual form.
// ---------------------------------------------------------------------------

vi.mock("../../../domain/auth/local-user-cache", () => ({
  loadCachedUsers: () => Promise.resolve(mockCachedUsers.current),
}));

// ---------------------------------------------------------------------------
// Mock the hook so we control all its return values per test.
// ---------------------------------------------------------------------------

const createMockReturn = (overrides?: Record<string, unknown>) => ({
  selectedUser: null as LocalUserInfo | null,
  showManualInput: false,
  identifier: "",
  password: "",
  error: null as string | null,
  isLoading: false,
  requiresTwoFactor: false,
  challengeToken: null as string | null,
  countdown: 0,
  authService: { login: vi.fn(), completeTwoFactor: vi.fn() } as unknown as AuthService,
  setSelectedUser: vi.fn(),
  handleUserSelect: vi.fn(),
  handlePinComplete: vi.fn(),
  handlePasswordLogin: vi.fn(),
  handleTwoFactorComplete: vi.fn(),
  handleTwoFactorCancel: vi.fn(),
  handleForgotPassword: vi.fn(),
  setShowManualInput: vi.fn(),
  setIdentifier: vi.fn(),
  setPassword: vi.fn(),
  ...overrides,
});

let mockLoginPageReturn: ReturnType<typeof createMockReturn>;

vi.mock("../../hooks/use-login-page", () => ({
  useLoginPage: () => mockLoginPageReturn,
}));

// ---------------------------------------------------------------------------
// Mock child components
// ---------------------------------------------------------------------------

vi.mock("./login-header", () => ({
  LoginHeader: () => <div data-testid="login-header" />,
}));

vi.mock("./avatar-grid", () => ({
  AvatarGrid: () => <div data-testid="avatar-grid" />,
}));

vi.mock("./manual-login-form", () => ({
  ManualLoginForm: () => <div data-testid="manual-login-form" />,
}));

vi.mock("./selected-user-credential", () => ({
  SelectedUserCredential: () => (
    <div data-testid="selected-user-credential" />
  ),
}));

vi.mock("./error-banner", () => ({
  ErrorBanner: ({ message }: { message: string }) => (
    <div data-testid="error-banner">{message}</div>
  ),
}));

vi.mock("./two-factor-modal", () => ({
  TwoFactorModal: () => <div data-testid="two-factor-modal" />,
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("LoginPage", () => {
  beforeEach(() => {
    mockLoginPageReturn = createMockReturn();
    mockSessionRef.current = null;
    vi.clearAllMocks();
  });

  // ── Already logged in ────────────────────────────────────────────────

  it("returns null when user is already logged in", () => {
    mockSessionRef.current = {
      userId: "user-1",
      username: "test",
      fullName: "Test User",
      displayName: "Test User",
      email: null,
      role: RoleType.CASHIER,
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

    const { container } = render(<LoginPage />);

    expect(container.innerHTML).toBe("");
  });

  // ── 2FA flow ─────────────────────────────────────────────────────────

  it("renders TwoFactorModal when requiresTwoFactor is true", () => {
    mockLoginPageReturn.requiresTwoFactor = true;
    mockLoginPageReturn.challengeToken = "challenge-abc";

    render(<LoginPage />);

    expect(screen.getByTestId("two-factor-modal")).toBeInTheDocument();
  });

  it("does not render LoginHeader when 2FA is active", () => {
    mockLoginPageReturn.requiresTwoFactor = true;
    mockLoginPageReturn.challengeToken = "challenge-abc";

    render(<LoginPage />);

    expect(
      screen.queryByTestId("login-header"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("avatar-grid"),
    ).not.toBeInTheDocument();
  });

  // ── Avatar grid (default state) ──────────────────────────────────────

  it("renders LoginHeader and AvatarGrid by default", async () => {
    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByTestId("login-header")).toBeInTheDocument();
      expect(screen.getByTestId("avatar-grid")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("manual-login-form"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("selected-user-credential"),
    ).not.toBeInTheDocument();
  });

  // ── Manual input mode ────────────────────────────────────────────────

  it("renders ManualLoginForm when showManualInput is true", async () => {
    mockLoginPageReturn.showManualInput = true;

    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByTestId("manual-login-form")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("avatar-grid"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("selected-user-credential"),
    ).not.toBeInTheDocument();
  });

  // Avatar grid is hidden when manual input is shown
  it("hides AvatarGrid when manual input is shown", async () => {
    mockLoginPageReturn.showManualInput = true;

    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByTestId("manual-login-form")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("avatar-grid"),
    ).not.toBeInTheDocument();
  });

  // ── Selected user ────────────────────────────────────────────────────

  it("renders SelectedUserCredential when a user is selected", async () => {
    mockLoginPageReturn.selectedUser = {
      id: "user-1",
      username: "jperez",
      displayName: "Juan Pérez",
      role: RoleType.CASHIER,
      avatarColor: "#2196F3",
      avatarUrl: null,
    };

    render(<LoginPage />);

    await waitFor(() => {
      expect(
        screen.getByTestId("selected-user-credential"),
      ).toBeInTheDocument();
    });
    // When a user is selected, the credential replaces the avatar grid
    expect(screen.queryByTestId("avatar-grid")).not.toBeInTheDocument();
    // Manual login form is not shown either
    expect(
      screen.queryByTestId("manual-login-form"),
    ).not.toBeInTheDocument();
  });

  it("hides manual form when user is selected", () => {
    mockLoginPageReturn.selectedUser = {
      id: "user-1",
      username: "jperez",
      displayName: "Juan Pérez",
      role: RoleType.CASHIER,
      avatarColor: "#2196F3",
      avatarUrl: null,
    };

    render(<LoginPage />);

    expect(
      screen.queryByTestId("manual-login-form"),
    ).not.toBeInTheDocument();
  });

  // ── Error state ─────────────────────────────────────────────────────

  it("renders ErrorBanner when an error exists and no user is selected", () => {
    mockLoginPageReturn.error = "Credenciales inválidas";

    render(<LoginPage />);

    expect(screen.getByTestId("error-banner")).toBeInTheDocument();
  });

  it("does not render ErrorBanner when a user is selected (error shown in credential)", () => {
    mockLoginPageReturn.error = "PIN incorrecto";
    mockLoginPageReturn.selectedUser = {
      id: "user-1",
      username: "jperez",
      displayName: "Juan Pérez",
      role: RoleType.CASHIER,
      avatarColor: "#2196F3",
      avatarUrl: null,
    };

    render(<LoginPage />);

    expect(
      screen.queryByTestId("error-banner"),
    ).not.toBeInTheDocument();
  });

  it("does not render ErrorBanner when error is null", () => {
    mockLoginPageReturn.error = null;

    render(<LoginPage />);

    expect(
      screen.queryByTestId("error-banner"),
    ).not.toBeInTheDocument();
  });
});
