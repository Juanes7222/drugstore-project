/**
 * Component tests for UserManagementPage.
 *
 * Covers: role gate (MANAGER+), user list, filters, create user modal,
 * loading/error/success states.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UserManagementPage } from "./user-management.page";
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
      disableUser: vi.fn(),
      enableUser: vi.fn(),
      unlockUser: vi.fn(),
      resetUserPin: vi.fn(),
    },
  };
});

vi.mock("../../../domain/auth/local-session.store", () => ({
  // The component both uses the hook (selector) and calls .getState() directly
  useLocalSessionStore: Object.assign(
    (selector: (s: typeof mockSessionState) => unknown) =>
      selector(mockSessionState),
    { getState: () => mockSessionState },
  ),
  hasMinRole: (
    session: LocalSession | null,
    minRole: RoleType,
  ): boolean => {
    if (!session) return false;
    const hierarchy: Record<string, number> = {
      CASHIER: 0,
      INVENTORY_ASSISTANT: 0,
      MANAGER: 1,
      ACCOUNTANT: 1,
      OWNER: 2,
      ADMIN: 2,
      SAAS_ADMIN: 3,
    };
    const userLevel = hierarchy[session.role as string] ?? -1;
    const requiredLevel = hierarchy[minRole] ?? -1;
    return userLevel >= requiredLevel;
  },
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

const mockUsers = [
  {
    id: "u-1",
    displayName: "María García",
    username: "maria.garcia",
    email: "maria@example.com",
    role: "MANAGER",
    status: "ACTIVE",
    isActive: true,
    lastLoginAt: "2026-07-13T08:00:00Z",
    avatarUrl: null,
    avatarColor: null,
  },
  {
    id: "u-2",
    displayName: "Carlos López",
    username: "carlos.lopez",
    email: "carlos@example.com",
    role: "CASHIER",
    status: "ACTIVE",
    isActive: true,
    lastLoginAt: "2026-07-12T14:30:00Z",
    avatarUrl: null,
    avatarColor: null,
  },
  {
    id: "u-3",
    displayName: "Ana Martínez",
    username: "ana.martinez",
    email: "ana@example.com",
    role: "CASHIER",
    status: "DISABLED",
    isActive: false,
    lastLoginAt: null,
    avatarUrl: null,
    avatarColor: null,
  },
];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("UserManagementPage", () => {
  beforeEach(() => {
    mockSessionState.session = null;
    vi.clearAllMocks();
  });

  describe("role gate", () => {
    it("shows no permission message when the user is CASHIER", () => {
      mockSessionState.session = {
        ...managerSession,
        role: RoleType.CASHIER,
      } as LocalSession;

      render(<UserManagementPage />);

      expect(
        screen.getByText(/no tiene permisos|no.permission/i),
      ).toBeInTheDocument();
    });

    it("renders the page for a MANAGER user", async () => {
      mockSessionState.session = managerSession;
      mockAuthService.listUsers = vi.fn().mockResolvedValue({
        users: mockUsers,
        total: 2,
      });

      render(<UserManagementPage />);

      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: /usuarios/i }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("user list", () => {
    it("renders a list of users after loading", async () => {
      mockSessionState.session = managerSession;
      mockAuthService.listUsers = vi.fn().mockResolvedValue({
        users: mockUsers,
        total: 2,
      });

      render(<UserManagementPage />);

      await waitFor(() => {
        expect(screen.getByText("María García")).toBeInTheDocument();
        expect(screen.getByText("Carlos López")).toBeInTheDocument();
      });
    });

    it("shows a loading state while fetching users", () => {
      mockSessionState.session = managerSession;
      mockAuthService.listUsers = vi.fn(
        () => new Promise(() => {}), // never resolves
      );

      render(<UserManagementPage />);

      expect(screen.getByText(/cargando|loading/i)).toBeInTheDocument();
    });

    it("shows an error message when the fetch fails", async () => {
      mockSessionState.session = managerSession;
      mockAuthService.listUsers = vi
        .fn()
        .mockRejectedValue(new Error("Network error"));

      render(<UserManagementPage />);

      await waitFor(() => {
        expect(
          screen.getByText(/error.*cargar|load.error/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe("filters", () => {
    it("renders role and status filter dropdowns", async () => {
      mockSessionState.session = managerSession;
      mockAuthService.listUsers = vi.fn().mockResolvedValue({
        users: mockUsers,
        total: 2,
      });

      render(<UserManagementPage />);

      await waitFor(() => {
        expect(
          screen.getByLabelText(/filtrar.*rol|filter.*role/i),
        ).toBeInTheDocument();
        expect(
          screen.getByLabelText(/filtrar.*estado|filter.*status/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe("create user modal", () => {
    it("opens the create user modal when the add button is clicked", async () => {
      mockSessionState.session = managerSession;
      mockAuthService.listUsers = vi.fn().mockResolvedValue({
        users: mockUsers,
        total: 2,
      });

      render(<UserManagementPage />);

      await waitFor(() => {
        expect(screen.getByText(/agregar usuario|add user/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText(/agregar usuario|add user/i));

      // Modal should show form fields
      expect(
        screen.getByText(/nombre|display name/i),
      ).toBeInTheDocument();
    });

    it("shows PIN field only when CASHIER role is selected", async () => {
      mockSessionState.session = managerSession;
      mockAuthService.listUsers = vi.fn().mockResolvedValue({
        users: mockUsers,
        total: 2,
      });

      render(<UserManagementPage />);

      await waitFor(() => {
        fireEvent.click(screen.getByText(/agregar usuario|add user/i));
      });

      // By default the role is CASHIER — PIN field should be visible
      expect(
        screen.getByText(/pin inicial|initial pin/i),
      ).toBeInTheDocument();
    });

    it("create button is disabled when display name is empty", async () => {
      mockSessionState.session = managerSession;
      mockAuthService.listUsers = vi.fn().mockResolvedValue({
        users: mockUsers,
        total: 2,
      });

      render(<UserManagementPage />);

      await waitFor(() => {
        fireEvent.click(screen.getByText(/agregar usuario|add user/i));
      });

      const createBtn = screen.getByRole("button", {
        name: /crear|create/i,
      });
      expect(createBtn).toBeDisabled();
    });

    it("calls authService.createUser when the create button is clicked", async () => {
      mockAuthService.createUser = vi.fn().mockResolvedValue({});
      mockSessionState.session = managerSession;
      mockAuthService.listUsers = vi.fn().mockResolvedValue({
        users: mockUsers,
        total: 2,
      });

      render(<UserManagementPage />);

      await waitFor(() => {
        fireEvent.click(screen.getByText(/agregar usuario|add user/i));
      });

      const nameInput = screen.getByPlaceholderText(
        /nombre del usuario|display.*name/i,
      );
      fireEvent.change(nameInput, { target: { value: "New User" } });

      fireEvent.click(
        screen.getByRole("button", { name: /crear|create/i }),
      );

      await waitFor(() => {
        expect(mockAuthService.createUser).toHaveBeenCalledWith({
          displayName: "New User",
          username: undefined,
          email: undefined,
          role: "CASHIER",
          initialPin: undefined,
        });
      });
    });

    it("shows success message after user creation", async () => {
      mockAuthService.createUser = vi.fn().mockResolvedValue({});
      mockSessionState.session = managerSession;
      mockAuthService.listUsers = vi.fn().mockResolvedValue({
        users: mockUsers,
        total: 2,
      });

      render(<UserManagementPage />);

      await waitFor(() => {
        fireEvent.click(screen.getByText(/agregar usuario|add user/i));
      });

      const nameInput = screen.getByPlaceholderText(
        /nombre del usuario|display.*name/i,
      );
      fireEvent.change(nameInput, { target: { value: "New User" } });

      fireEvent.click(
        screen.getByRole("button", { name: /crear|create/i }),
      );

      await waitFor(() => {
        expect(
          screen.getByText(/usuario.*creado|user.*created/i),
        ).toBeInTheDocument();
      });
    });
  });

  // -----------------------------------------------------------------------
  // User actions — disable/enable, reset PIN
  // -----------------------------------------------------------------------

  describe("user actions", () => {
    beforeEach(() => {
      mockSessionState.session = managerSession;

      // Clear mocks FIRST, then set up fresh ones
      vi.clearAllMocks();

      mockAuthService.listUsers = vi.fn().mockResolvedValue({
        users: mockUsers,
        total: 3,
      });
      mockAuthService.disableUser = vi.fn().mockResolvedValue({ message: "User disabled" });
      mockAuthService.enableUser = vi.fn().mockResolvedValue({ message: "User enabled" });
      mockAuthService.resetUserPin = vi.fn().mockResolvedValue({
        newPin: "654321",
        message: "PIN has been reset. Share the new PIN with the user.",
      });
    });

    // -----------------------------------------------------------------
    // Button text
    // -----------------------------------------------------------------

    it("shows 'disable' button for active users", async () => {
      render(<UserManagementPage />);

      // u-2 is an active cashier — button should say "Desactivar"
      await screen.findByText("Carlos López");

      const disableBtns = screen.getAllByRole("button", {
        name: /desactivar|disable/i,
      });
      // u-1 (manager self) buttons hidden, u-2 shows Desactivar, u-3 shows Activar
      expect(disableBtns.length).toBeGreaterThanOrEqual(1);
    });

    it("shows 'enable' button for disabled users", async () => {
      render(<UserManagementPage />);

      await screen.findByText("Ana Martínez");

      // Use exact match: "Activar" — NOT /activar/i which matches "Desactivar" too
      const enableBtns = screen.getAllByRole("button", {
        name: (name) => name === "Activar",
      });
      expect(enableBtns.length).toBe(1);
    });

    it("does not show action buttons for the current logged-in user", async () => {
      render(<UserManagementPage />);

      await screen.findByText("María García");

      // The manager (u-1) is the current user — no buttons for them
      const userRow = screen.getByText("María García").closest("tr")!;
      const buttons = userRow.querySelectorAll("button");
      expect(buttons.length).toBe(0);
    });

    // -----------------------------------------------------------------
    // Disable active user
    // -----------------------------------------------------------------

    it("calls authService.disableUser when disabling an active user", async () => {
      render(<UserManagementPage />);

      await screen.findByText("Carlos López");

      // Only active users show "Desactivar" button
      const disableBtn = screen.getByRole("button", {
        name: /desactivar|disable/i,
      });
      fireEvent.click(disableBtn);

      await waitFor(() => {
        expect(mockAuthService.disableUser).toHaveBeenCalledWith("u-2");
      });
    });

    it("shows success message after disabling a user", async () => {
      mockAuthService.disableUser = vi.fn().mockResolvedValue({ message: "User disabled" });

      render(<UserManagementPage />);

      await screen.findByText("Carlos López");

      const disableBtn = screen.getByRole("button", {
        name: /desactivar|disable/i,
      });
      fireEvent.click(disableBtn);

      await waitFor(() => {
        expect(
          screen.getByText(/usuario desactivado|user disabled/i),
        ).toBeInTheDocument();
      });
    });

    // -----------------------------------------------------------------
    // Enable disabled user
    // -----------------------------------------------------------------

    it("calls authService.enableUser when enabling a disabled user", async () => {
      render(<UserManagementPage />);

      await screen.findByText("Ana Martínez");

      // Exact name match to avoid matching "Desactivar" (contains "activar")
      const enableBtn = screen.getByRole("button", {
        name: (name) => name === "Activar",
      });
      fireEvent.click(enableBtn);

      await waitFor(() => {
        expect(mockAuthService.enableUser).toHaveBeenCalledWith("u-3");
      });
    });

    it("shows success message after enabling a user", async () => {
      mockAuthService.enableUser = vi.fn().mockResolvedValue({ message: "User enabled" });

      render(<UserManagementPage />);

      await screen.findByText("Ana Martínez");

      const enableBtn = screen.getByRole("button", {
        name: (name) => name === "Activar",
      });
      fireEvent.click(enableBtn);

      await waitFor(() => {
        expect(
          screen.getByText(/usuario activado|user enabled/i),
        ).toBeInTheDocument();
      });
    });

    // -----------------------------------------------------------------
    // Reset PIN
    // -----------------------------------------------------------------

    it("calls authService.resetUserPin when resetting a user's PIN", async () => {
      render(<UserManagementPage />);

      await screen.findByText("Carlos López");

      // The reset PIN button title is "Reset PIN" (same in both locales)
      const resetPinBtns = screen.getAllByRole("button", {
        name: /reset pin/i,
      });
      fireEvent.click(resetPinBtns[0]);

      await waitFor(() => {
        expect(mockAuthService.resetUserPin).toHaveBeenCalledWith("u-2");
      });
    });

    it("shows success message after PIN reset", async () => {
      mockAuthService.resetUserPin = vi.fn().mockResolvedValue({
        newPin: "654321",
        message: "PIN has been reset",
      });

      render(<UserManagementPage />);

      await screen.findByText("Carlos López");

      const resetPinBtns = screen.getAllByRole("button", {
        name: /reset pin/i,
      });
      fireEvent.click(resetPinBtns[0]);

      // Success message contains "PIN reseteado" — avoid matching button text
      await waitFor(() => {
        expect(
          screen.getByText((content) =>
            /PIN reseteado/i.test(content) || /PIN.+reset/i.test(content),
          ),
        ).toBeInTheDocument();
      });
    });

    // -----------------------------------------------------------------
    // Error handling
    // -----------------------------------------------------------------

    it("shows error message when disableUser fails", async () => {
      mockAuthService.disableUser = vi
        .fn()
        .mockRejectedValue(new Error("Server error"));

      render(<UserManagementPage />);

      await screen.findByText("Carlos López");

      const disableBtn = screen.getByRole("button", {
        name: /desactivar|disable/i,
      });
      fireEvent.click(disableBtn);

      await waitFor(() => {
        expect(
          screen.getByText(/error.*desactivar|disable.*error/i),
        ).toBeInTheDocument();
      });
    });

    it("shows error message when resetPin fails", async () => {
      mockAuthService.resetUserPin = vi
        .fn()
        .mockRejectedValue(new Error("Server error"));

      render(<UserManagementPage />);

      await screen.findByText("Carlos López");

      const resetPinBtns = screen.getAllByRole("button", {
        name: /reset pin/i,
      });
      fireEvent.click(resetPinBtns[0]);

      await waitFor(() => {
        expect(
          screen.getByText(/error.*reset.*pin|reset.*error.*pin/i),
        ).toBeInTheDocument();
      });
    });
  });
});
