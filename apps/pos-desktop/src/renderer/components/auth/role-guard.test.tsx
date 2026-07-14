/**
 * Component tests for RoleGuard and withRoleGuard HOC.
 *
 * Covers: session check, role matching, fallback rendering, HOC wrapper.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RoleGuard, withRoleGuard } from "./role-guard";
import { RoleType } from "@pharmacy/shared-types";
import type { LocalSession } from "../../../domain/auth/local-session.store";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockSessionState } = vi.hoisted(() => {
  const state: { session: LocalSession | null; isInitialized: boolean } = {
    session: null,
    isInitialized: true,
  };
  return { mockSessionState: state };
});

vi.mock("../../../domain/auth", () => ({
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

const managerSession: Partial<LocalSession> = {
  userId: "u-1",
  username: "maria.garcia",
  displayName: "María García",
  role: RoleType.MANAGER,
  workstationId: "ws-1",
  accessToken: "tok",
  refreshToken: "rtok",
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

describe("RoleGuard", () => {
  afterEach(() => {
    mockSessionState.session = null;
  });

  it("renders children when the session exists and the role matches", () => {
    mockSessionState.session = managerSession as LocalSession;

    render(
      <RoleGuard allow={[RoleType.MANAGER]}>
        <p>Admin content</p>
      </RoleGuard>,
    );

    expect(screen.getByText("Admin content")).toBeInTheDocument();
  });

  it("renders fallback when the session exists but the role does not match", () => {
    mockSessionState.session = managerSession as LocalSession;

    render(
      <RoleGuard
        allow={[RoleType.OWNER]}
        fallback={<p>Access denied</p>}
      >
        <p>Owner only</p>
      </RoleGuard>,
    );

    expect(screen.getByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByText("Owner only")).not.toBeInTheDocument();
  });

  it("renders fallback when there is no session", () => {
    mockSessionState.session = null;

    render(
      <RoleGuard allow={[RoleType.OWNER]} fallback={<p>Not logged in</p>}>
        <p>Secret</p>
      </RoleGuard>,
    );

    expect(screen.getByText("Not logged in")).toBeInTheDocument();
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();
  });

  it("renders nothing (empty fallback) when no session and no fallback", () => {
    mockSessionState.session = null;

    const { container } = render(
      <RoleGuard allow={[RoleType.MANAGER]}>
        <p>Secret</p>
      </RoleGuard>,
    );

    expect(container.textContent).toBe("");
  });

  it("allows any role when the session role is SAAS_ADMIN (highest privilege)", () => {
    mockSessionState.session = {
      ...managerSession,
      role: RoleType.SAAS_ADMIN,
    } as LocalSession;

    render(
      <RoleGuard allow={[RoleType.MANAGER]}>
        <p>Allowed</p>
      </RoleGuard>,
    );

    expect(screen.getByText("Allowed")).toBeInTheDocument();
  });
});

describe("withRoleGuard HOC", () => {
  afterEach(() => {
    mockSessionState.session = null;
  });

  it("wraps a component and guards it by role", () => {
    mockSessionState.session = managerSession as LocalSession;

    const TestComponent = () => <p>Wrapped</p>;
    const GuardedComponent = withRoleGuard([RoleType.MANAGER])(TestComponent);

    render(<GuardedComponent />);

    expect(screen.getByText("Wrapped")).toBeInTheDocument();
  });

  it("renders fallback when the HOC-guarded component is accessed with wrong role", () => {
    mockSessionState.session = managerSession as LocalSession;

    const TestComponent = () => <p>Wrapped</p>;
    const GuardedComponent = withRoleGuard(
      [RoleType.OWNER],
      <p>No access</p>,
    )(TestComponent);

    render(<GuardedComponent />);

    expect(screen.getByText("No access")).toBeInTheDocument();
    expect(screen.queryByText("Wrapped")).not.toBeInTheDocument();
  });
});
