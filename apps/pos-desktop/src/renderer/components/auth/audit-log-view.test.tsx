/**
 * Component tests for AuditLogView.
 *
 * Covers: role gate (MANAGER+), event filter, date range inputs,
 * log entries table, pagination controls.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuditLogView } from "./audit-log-view";
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

const mockLogEntries = [
  {
    id: "log-1",
    action: "AUTH_LOGIN_SUCCESS",
    createdAt: "2026-07-13T08:00:00Z",
    userId: "u-1",
    userRole: "MANAGER",
    entityType: "Session",
    entityId: "s-1",
    details: null,
  },
  {
    id: "log-2",
    action: "STEP_UP_AUTHORIZED",
    createdAt: "2026-07-13T09:30:00Z",
    userId: "u-2",
    userRole: "OWNER",
    entityType: "StepUpRequest",
    entityId: "stepup-1",
    details: '{"method":"PIN"}',
  },
];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AuditLogView", () => {
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

      render(<AuditLogView />);

      expect(
        screen.getByText(/No tiene permisos para ver esta página/),
      ).toBeInTheDocument();
    });

    it("renders the page for a MANAGER user", async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs = vi.fn().mockResolvedValue({
        rows: mockLogEntries,
        total: 2,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(
          screen.getByText(/registro de auditor.a|audit log/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe("filters", () => {
    it("renders event filter select with all event options", async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs = vi.fn().mockResolvedValue({
        rows: mockLogEntries,
        total: 2,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(
          screen.getByLabelText(/evento|event/i),
        ).toBeInTheDocument();
      });
    });

    it("renders date range inputs (from/to)", async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs = vi.fn().mockResolvedValue({
        rows: mockLogEntries,
        total: 2,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(
          screen.getByLabelText("Desde"),
        ).toBeInTheDocument();
        expect(
          screen.getByLabelText("Hasta"),
        ).toBeInTheDocument();
      });
    });
  });

  describe("log entries", () => {
    it("renders log entries in a table", async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs = vi.fn().mockResolvedValue({
        rows: mockLogEntries,
        total: 2,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        // Each log entry's action column shows the translated event name
        expect(screen.getByText("Inicio de sesión")).toBeInTheDocument();
      });
    });

    it("shows a loading indicator while fetching logs", () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs = vi.fn(
        () => new Promise(() => {}), // never resolves
      );

      render(<AuditLogView />);

      expect(screen.getByText(/cargando|loading/i)).toBeInTheDocument();
    });

    it("shows an empty state when there are no logs", async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs = vi.fn().mockResolvedValue({
        rows: [],
        total: 0,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(
          screen.getByText(/no hay eventos|no.*events/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe("pagination", () => {
    it("renders pagination controls with Previous / Next buttons", async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs = vi.fn().mockResolvedValue({
        rows: mockLogEntries,
        total: 100, // > pageSize (50), so pagination is active
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /anterior|previous/i }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: /siguiente|next/i }),
        ).toBeInTheDocument();
      });
    });

    it("disables the Previous button on the first page", async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs = vi.fn().mockResolvedValue({
        rows: mockLogEntries,
        total: 100,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /anterior|previous/i }),
        ).toBeDisabled();
      });
    });

    it("shows the current page indicator", async () => {
      mockSessionState.session = managerSession;
      mockAuthService.getAuditLogs = vi.fn().mockResolvedValue({
        rows: mockLogEntries,
        total: 100,
      });

      render(<AuditLogView />);

      await waitFor(() => {
        expect(screen.getByText(/1 \/ 2|1 \/ /)).toBeInTheDocument();
      });
    });
  });
});
