/**
 * Component tests for AuthRedirect and withAuth HOC.
 *
 * Covers: children rendering when session exists, fallback when no session,
 * dispatch on isInitialized && !session.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthRedirect, withAuth } from "./auth-redirect";
import type { LocalSession } from "../../../domain/auth/local-session.store";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const dispatch = vi.fn();

const { mockSessionState } = vi.hoisted(() => {
  const state: { session: LocalSession | null; isInitialized: boolean } = {
    session: null,
    isInitialized: false,
  };
  return { mockSessionState: state };
});

vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => dispatch,
}));

vi.mock("../../../domain/auth/local-session.store", () => ({
  useLocalSessionStore: (selector: (s: typeof mockSessionState) => unknown) =>
    selector(mockSessionState),
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AuthRedirect", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockSessionState.session = null;
    mockSessionState.isInitialized = false;
  });

  it("renders children when a session exists", () => {
    mockSessionState.session = {
      userId: "u-1",
      username: "test",
      displayName: "Test User",
      role: "CASHIER",
      workstationId: "ws-1",
    } as LocalSession;
    mockSessionState.isInitialized = true;

    render(
      <AuthRedirect>
        <p>Protected content</p>
      </AuthRedirect>,
    );

    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });

  it("renders fallback when there is no session", () => {
    mockSessionState.session = null;
    mockSessionState.isInitialized = true;

    render(
      <AuthRedirect fallback={<p>Please log in</p>}>
        <p>Protected content</p>
      </AuthRedirect>,
    );

    expect(screen.getByText("Please log in")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("dispatches setActiveScreen('login') when isInitialized and no session", () => {
    mockSessionState.session = null;
    mockSessionState.isInitialized = true;

    render(
      <AuthRedirect>
        <p>Content</p>
      </AuthRedirect>,
    );

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ui/setActiveScreen",
        payload: "login",
      }),
    );
  });

  it("does not dispatch when isInitialized is false even without session", () => {
    mockSessionState.session = null;
    mockSessionState.isInitialized = false;

    render(
      <AuthRedirect>
        <p>Content</p>
      </AuthRedirect>,
    );

    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("withAuth HOC", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockSessionState.session = null;
  });

  it("wraps a component and renders children when session exists", () => {
    mockSessionState.session = {
      userId: "u-1",
      username: "test",
      displayName: "Test User",
      role: "CASHIER",
      workstationId: "ws-1",
    } as LocalSession;

    const TestComponent = () => <p>Authed</p>;
    const AuthedComponent = withAuth()(TestComponent);

    render(<AuthedComponent />);

    expect(screen.getByText("Authed")).toBeInTheDocument();
  });

  it("renders fallback when no session", () => {
    mockSessionState.session = null;

    const TestComponent = () => <p>Authed</p>;
    const AuthedComponent = withAuth(<p>Login please</p>)(TestComponent);

    render(<AuthedComponent />);

    expect(screen.getByText("Login please")).toBeInTheDocument();
    expect(screen.queryByText("Authed")).not.toBeInTheDocument();
  });
});
