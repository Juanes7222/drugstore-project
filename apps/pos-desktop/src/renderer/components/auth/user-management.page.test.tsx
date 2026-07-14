/**
 * Component tests for UserManagementPage.
 *
 * Covers: role gate (MANAGER+), user list, filters, create user modal,
 * loading/error/success states.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
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
    },
  };
});

vi.mock("../../../domain/auth/local-session.store", () => ({
  useLocalSessionStore: (selector: (s: typeof mockSessionState) => unknown) =>
    selector(mockSessionState),
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
});
