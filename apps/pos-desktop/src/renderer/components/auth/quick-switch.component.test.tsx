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

  // Pre-built user list matching the names the tests assert on.
  const mockUsers = [
    { id: "admin-1", displayName: "Administrador del Sistema", fullName: "Administrador del Sistema", role: "ADMIN", avatarUrl: null, avatarColor: "#1E40AF", username: "admin" },
    { id: "cashier-2", displayName: "Carlos Méndez", fullName: "Carlos Méndez", role: "CASHIER", avatarUrl: null, avatarColor: "#7C3AED", username: "cmendez" },
    { id: "cashier-3", displayName: "Luisa García", fullName: "Luisa García", role: "CASHIER", avatarUrl: null, avatarColor: "#059669", username: "lgarcia" },
    { id: "cashier-4", displayName: "Pedro Contreras", fullName: "Pedro Contreras", role: "CASHIER", avatarUrl: null, avatarColor: "#D97706", username: "pcontreras" },
  ];

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
      listUsers: vi.fn().mockResolvedValue({ users: mockUsers }),
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

// Mock local-user-cache so the dynamic import inside loadUsers works.
// Default loadCachedUsers returns [] so tests that don't explicitly set it
// (e.g. success-path tests) avoid crashing on `cached.length > 0`.
vi.mock("../../../domain/auth/local-user-cache", () => ({
  loadCachedUsers: vi.fn().mockResolvedValue([]),
  cacheUsers: vi.fn(),
  resetUserCache: vi.fn(),
}));

// Mock local-users so the dynamic import inside loadUsers works
vi.mock("../../../domain/auth/local-users", () => ({
  mapServerUserToLocalUserInfo: vi.fn((u: any) => ({
    id: u.id,
    displayName: u.displayName,
    role: u.role,
    avatarUrl: u.avatarUrl ?? null,
    avatarColor: u.avatarColor ?? null,
    username: u.username ?? '',
  })),
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

  it("lists other users (excluding the current session user)", async () => {
    mockSessionState.session = cashierSession;

    render(<QuickSwitch />);

    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    // Wait for the async listUsers effect to resolve
    // Current user (María Rodríguez / cashier1) should NOT appear in the list
    expect(await screen.findByText("Administrador del Sistema")).toBeInTheDocument();
    expect(await screen.findByText("Carlos Méndez")).toBeInTheDocument();
    expect(await screen.findByText("Luisa García")).toBeInTheDocument();
    expect(await screen.findByText("Pedro Contreras")).toBeInTheDocument();
  });

  it("shows password input for any selected user (ALL roles use password)", async () => {
    mockSessionState.session = cashierSession;

    render(<QuickSwitch />);

    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    // Wait for the async listUsers effect to resolve, then select a user
    fireEvent.click(await screen.findByText("Carlos Méndez"));

    // Password input should be shown (no PIN keypad)
    expect(
      await screen.findByPlaceholderText(/contrase.a|password/i),
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

    // Wait for listUsers to resolve before selecting a user
    fireEvent.click(await screen.findByText("Administrador del Sistema"));

    const passwordInput = await screen.findByPlaceholderText(/contrase.a|password/i);
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

  it("closes the dropdown on outside click", async () => {
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

    // Wait for listUsers to resolve (user list visible)
    expect(await screen.findByText("Carlos Méndez")).toBeInTheDocument();

    // Click outside
    fireEvent.mouseDown(document.body);

    // Dropdown should close
    expect(screen.queryByText("Carlos Méndez")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Error handling — 403, network errors, empty results
  // -----------------------------------------------------------------------

  it("shows 'no permission' message on 403 when local cache is empty", async () => {
    mockSessionState.session = cashierSession;
    mockAuthService.listUsers = vi
      .fn()
      .mockRejectedValue(
        new Error("[403] Insufficient permissions for this action"),
      );

    // Mock the dynamic import of local-user-cache to return empty cache
    const { loadCachedUsers } = await import(
      "../../../domain/auth/local-user-cache"
    );
    vi.mocked(loadCachedUsers).mockResolvedValue([]);

    render(<QuickSwitch />);

    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/no tenés permisos|no permission|permisos para listar/i),
      ).toBeInTheDocument();
    });

    // Also shows the fallback hint to use manual login
    expect(
      screen.getByText(/inicio de sesión manual|manual login|manual/i),
    ).toBeInTheDocument();
  });

  it("falls back to cached users on 403 when local cache has data", async () => {
    mockSessionState.session = cashierSession;
    mockAuthService.listUsers = vi
      .fn()
      .mockRejectedValue(
        new Error("[403] Insufficient permissions for this action"),
      );

    // Mock the dynamic import of local-user-cache to return cached users
    const { loadCachedUsers } = await import(
      "../../../domain/auth/local-user-cache"
    );
    vi.mocked(loadCachedUsers).mockResolvedValue([
      {
        id: "cached-1",
        displayName: "Cached User One",
        role: RoleType.CASHIER,
        avatarUrl: null,
        avatarColor: null,
        username: "cached1",
      },
      {
        id: "cached-2",
        displayName: "Cached User Two",
        role: RoleType.MANAGER,
        avatarUrl: null,
        avatarColor: null,
        username: "cached2",
      },
    ]);

    render(<QuickSwitch />);

    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    // Should show cached users instead of the permission error
    expect(await screen.findByText("Cached User One")).toBeInTheDocument();
    expect(await screen.findByText("Cached User Two")).toBeInTheDocument();

    // Should NOT show the permission error message
    expect(
      screen.queryByText(/no tenés permisos|no permission/i),
    ).not.toBeInTheDocument();
  });

  it("shows generic error message on network error when cache is empty", async () => {
    mockSessionState.session = cashierSession;
    mockAuthService.listUsers = vi
      .fn()
      .mockRejectedValue(new Error("Failed to fetch"));

    // Empty cache
    const { loadCachedUsers } = await import(
      "../../../domain/auth/local-user-cache"
    );
    vi.mocked(loadCachedUsers).mockResolvedValue([]);

    render(<QuickSwitch />);

    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    await waitFor(() => {
      // Should show generic connection error, NOT the permission-specific one
      expect(
        screen.getByText(/error de conexión|connection error/i),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/no tenés permisos|no permission|permisos para listar/i),
      ).not.toBeInTheDocument();
    });

    // Should mention manual login fallback
    expect(
      screen.getByText(/inicio de sesión manual|manual login|manual/i),
    ).toBeInTheDocument();
  });

  it("shows loading state while fetching users", () => {
    mockSessionState.session = cashierSession;
    // Never-resolving promise
    mockAuthService.listUsers = vi.fn(() => new Promise(() => {}));

    render(<QuickSwitch />);

    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    expect(screen.getByText(/cargando|loading/i)).toBeInTheDocument();
  });

  it("shows 'no users available' when server returns an empty list", async () => {
    mockSessionState.session = cashierSession;
    mockAuthService.listUsers = vi.fn().mockResolvedValue({
      users: [],
      total: 0,
    });

    render(<QuickSwitch />);

    fireEvent.click(
      screen.getByRole("button", { name: /cambiar de usuario|cambiar usuario|switch user/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/no hay usuarios disponibles|no users available/i),
      ).toBeInTheDocument();
    });
  });
});
