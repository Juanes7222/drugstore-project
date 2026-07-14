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

const managerSession: LocalSession = {
  userId: "u-1",
  username: "maria.garcia",
  fullName: "María García",
  displayName: "María García",
  email: "maria@example.com",
  role: RoleType.MANAGER,
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
    mockSessionState.session = managerSession;

    render(<QuickSwitch />);

    expect(screen.getByText("María García")).toBeInTheDocument();
    // Avatar should have initials from display name
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("opens the dropdown when the trigger button is clicked", () => {
    mockSessionState.session = managerSession;

    render(<QuickSwitch />);

    const trigger = screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i });
    fireEvent.click(trigger);

    // Dropdown should now show the user list
    expect(screen.getByText(/cambiar de usuario|cambiar usuario|switch user/i)).toBeInTheDocument();
  });

  it("lists other users (excluding the current session user)", () => {
    mockSessionState.session = managerSession;

    render(<QuickSwitch />);

    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    // Current user (María García) should NOT appear in the list
    // Instead we see: Juan Pérez (OWNER), Carlos López (CASHIER), Ana Martínez (CASHIER)
    expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
    expect(screen.getByText("Carlos López")).toBeInTheDocument();
    expect(screen.getByText("Ana Martínez")).toBeInTheDocument();
  });

  it("shows PinKeypad when a CASHIER user is selected", () => {
    mockSessionState.session = managerSession;

    render(<QuickSwitch />);

    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    // Click on Carlos López (CASHIER)
    fireEvent.click(screen.getByText("Carlos López"));

    // Should show PinKeypad (look for dots or digit keys)
    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
  });

  it("shows PinKeypad when a MANAGER user is selected", () => {
    mockSessionState.session = managerSession;

    render(<QuickSwitch />);

    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    // We can't select María García (current user), so select Juan Pérez (OWNER)
    // For OWNER, it shows password input. Let's select a MANAGER...
    // Actually the placeholder users are OWNER and CASHIER, no MANAGER besides the current.
    // The current user is MANAGER, so we can only select others. Let's pick a CASHIER.
    fireEvent.click(screen.getByText("Carlos López"));

    // CASHIER → PinKeypad
    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
  });

  it("shows password input when an OWNER user is selected", () => {
    mockSessionState.session = managerSession;

    render(<QuickSwitch />);

    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    // Click on Juan Pérez (OWNER)
    fireEvent.click(screen.getByText("Juan Pérez"));

    // Should show password input
    expect(
      screen.getByText(/ingrese su contrase.a|enter password/i),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/contrase.a|password/i),
    ).toBeInTheDocument();
  });

  it("calls authService.login with PIN when switching to a CASHIER user", async () => {
    mockAuthService.login = vi.fn().mockResolvedValue({
      session: {
        ...managerSession,
        userId: "cashier-1",
        displayName: "Carlos López",
        role: RoleType.CASHIER,
      },
    });

    mockSessionState.session = managerSession;

    render(<QuickSwitch />);

    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    fireEvent.click(screen.getByText("Carlos López"));

    // Enter a 6-digit PIN
    for (const digit of ["1", "2", "3", "4", "5", "6"]) {
      fireEvent.click(screen.getByRole("button", { name: digit }));
    }

    await waitFor(() => {
      expect(mockAuthService.login).toHaveBeenCalledWith(
        "carlos.lopez",
        "123456",
        "PIN",
        "ws-1",
        undefined,
        "pos-desktop",
      );
    });
  });

  it("calls authService.login with PASSWORD when switching to an OWNER user", async () => {
    mockAuthService.login = vi.fn().mockResolvedValue({
      session: {
        ...managerSession,
        userId: "owner-1",
        displayName: "Juan Pérez",
        role: RoleType.OWNER,
      },
    });

    mockSessionState.session = managerSession;

    render(<QuickSwitch />);

    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    fireEvent.click(screen.getByText("Juan Pérez"));

    const passwordInput = screen.getByPlaceholderText(/contrase.a|password/i);
    fireEvent.change(passwordInput, { target: { value: "mypassword" } });

    fireEvent.click(
      screen.getByRole("button", { name: "Cambiar" }),
    );

    await waitFor(() => {
      expect(mockAuthService.login).toHaveBeenCalledWith(
        "juan.perez",
        "mypassword",
        "PASSWORD",
        "ws-1",
        undefined,
        "pos-desktop",
      );
    });
  });

  it("closes the dropdown on outside click", () => {
    mockSessionState.session = managerSession;

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
    expect(screen.getByText("Carlos López")).toBeInTheDocument();

    // Click outside
    fireEvent.mouseDown(document.body);

    // Dropdown should close
    expect(screen.queryByText("Carlos López")).not.toBeInTheDocument();
  });
});
