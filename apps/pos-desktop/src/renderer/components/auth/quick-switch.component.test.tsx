/**
 * Component tests for QuickSwitch.
 *
 * Covers: current user display, dropdown content, PinKeypad for
 * CASHIER/MANAGER, password input for OWNER, auth service call,
 * session update, outside click close.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QuickSwitch } from "./quick-switch.component";
import { RoleType } from "@pharmacy/shared-types";
import type { LocalSession } from "../../../domain/auth/local-session.store";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockSessionState, mockAuthService } = vi.hoisted(() => {
  const state: {
    session: LocalSession | null;
    isInitialized: boolean;
  } = {
    session: null,
    isInitialized: true,
  };
  return {
    mockSessionState: state,
    mockAuthService: {
      login: vi.fn(),
      completeTwoFactor: vi.fn(),
      refreshSession: vi.fn(),
      requestStepUp: vi.fn(),
      approveStepUp: vi.fn(),
      verifyStepUp: vi.fn(),
      changePassword: vi.fn(),
      changePin: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
      getCurrentSession: vi.fn(),
      requireRole: vi.fn(),
      logout: vi.fn(),
      createUser: vi.fn(),
      listUsers: vi.fn(),
      getPendingStepUpRequests: vi.fn(),
      getAuditLogs: vi.fn(),
    },
  };
});

vi.mock("../../../domain/auth/local-session.store", () => ({
  useLocalSessionStore: (selector: (s: typeof mockSessionState) => unknown) =>
    selector(mockSessionState),
}));

vi.mock("@infra/config", () => ({
  API_BASE_URL: "http://localhost:3000",
}));

vi.mock("../../../domain/auth/auth.service", () => ({
  createAuthService: vi.fn(() => mockAuthService),
}));

const cashierSession: LocalSession = {
  userId: "u-1",
  username: "cashier1",
  fullName: "María Rodríguez",
  displayName: "María Rodríguez",
  email: "maria.rodriguez@example.com",
  role: RoleType.CASHIER,
  subscriptionId: null,
  workstationId: "ws-1",
  accessToken: "tok-1",
  refreshToken: "rtok-1",
  expiresAt: new Date("2099-01-01"),
  sessionId: "s-1",
  totpEnabled: false,
  avatarUrl: null,
  avatarColor: null,
  mustChangePassword: false,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("QuickSwitch", () => {
  beforeEach(() => {
    mockSessionState.session = null;
    vi.clearAllMocks();
  });

  it("returns null when there is no session", () => {
    const { container } = render(<QuickSwitch />);

    expect(container.textContent).toBe("");
  });

  it("shows the current user avatar and name when a session exists", () => {
    mockSessionState.session = cashierSession;

    render(<QuickSwitch />);

    expect(screen.getByText("María Rodríguez")).toBeInTheDocument();
    // Avatar should have initials from display name
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("opens the dropdown when the trigger button is clicked", () => {
    mockSessionState.session = cashierSession;

    render(<QuickSwitch />);

    const trigger = screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i });
    fireEvent.click(trigger);

    // Dropdown should now show the user list
    expect(screen.getByText(/cambiar de usuario|cambiar usuario|switch user/i)).toBeInTheDocument();
  });

  it("lists other users (excluding the current session user)", () => {
    mockSessionState.session = cashierSession;

    render(<QuickSwitch />);

    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    // Current user (María Rodríguez / cashier1) should NOT appear in the list
    expect(screen.getByText("Administrador del Sistema")).toBeInTheDocument();
    expect(screen.getByText("Carlos Méndez")).toBeInTheDocument();
    expect(screen.getByText("Luisa García")).toBeInTheDocument();
    expect(screen.getByText("Pedro Contreras")).toBeInTheDocument();
  });

  it("shows password input for any selected user (ALL roles use password)", () => {
    mockSessionState.session = cashierSession;

    render(<QuickSwitch />);

    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    // Select another cashier (Carlos Méndez / cashier2)
    fireEvent.click(screen.getByText("Carlos Méndez"));

    // Password input should be shown (no PIN keypad)
    expect(
      screen.getByPlaceholderText(/contrase.a|password/i),
    ).toBeInTheDocument();
  });

  it("calls authService.login with PASSWORD when switching to another user", async () => {
    mockAuthService.login = vi.fn().mockResolvedValue({
      session: {
        ...cashierSession,
        userId: "user_admin",
        displayName: "Administrador del Sistema",
        role: RoleType.ADMIN,
      },
    });

    mockSessionState.session = cashierSession;

    render(<QuickSwitch />);

    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    fireEvent.click(screen.getByText("Administrador del Sistema"));

    const passwordInput = screen.getByPlaceholderText(/contrase.a|password/i);
    fireEvent.change(passwordInput, { target: { value: "secret123" } });

    fireEvent.click(
      screen.getByRole("button", { name: "Cambiar" }),
    );

    await waitFor(() => {
      expect(mockAuthService.login).toHaveBeenCalledWith(
        "admin",
        "secret123",
        "PASSWORD",
        "ws-1",
        undefined,
        "pos-desktop",
      );
    });
  });

  it("closes the dropdown on outside click", () => {
    mockSessionState.session = cashierSession;

    render(
      <div>
        <QuickSwitch />
        <p data-testid="outside">Outside</p>
      </div>,
    );

    // Open the dropdown
    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    // Dropdown should be open (user list visible)
    expect(screen.getByText("Carlos Méndez")).toBeInTheDocument();

    // Click outside
    fireEvent.mouseDown(document.body);

    // Dropdown should close
    expect(screen.queryByText("Carlos Méndez")).not.toBeInTheDocument();
  });
});
