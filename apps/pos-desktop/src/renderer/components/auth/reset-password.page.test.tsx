/**
 * Component tests for ResetPasswordPage.
 *
 * Covers: password inputs, mismatch error, min length validation,
 * submit disabled, success view, token extraction from URL.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ResetPasswordPage } from "./reset-password.page";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const dispatch = vi.fn();

const { mockAuthService } = vi.hoisted(() => ({
  mockAuthService: {
    forgotPassword: vi.fn(),
    login: vi.fn(),
    completeTwoFactor: vi.fn(),
    refreshSession: vi.fn(),
    requestStepUp: vi.fn(),
    approveStepUp: vi.fn(),
    verifyStepUp: vi.fn(),
    changePassword: vi.fn(),
    changePin: vi.fn(),
    resetPassword: vi.fn(),
    getCurrentSession: vi.fn(),
    requireRole: vi.fn(),
    logout: vi.fn(),
    createUser: vi.fn(),
    listUsers: vi.fn(),
    getPendingStepUpRequests: vi.fn(),
    getAuditLogs: vi.fn(),
  },
}));

vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => dispatch,
}));

vi.mock("@infra/config", () => ({
  API_BASE_URL: "http://localhost:3000",
}));

vi.mock("../../../domain/auth/auth.service", () => ({
  createAuthService: vi.fn(() => mockAuthService),
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ResetPasswordPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the new password and confirm password inputs", () => {
    render(<ResetPasswordPage token="tok-123" />);

    const inputs = screen.getAllByDisplayValue("");
    // Two password inputs
    expect(inputs).toHaveLength(2);
  });

  it("submit button is disabled when either field is empty", () => {
    render(<ResetPasswordPage token="tok-123" />);

    const save = screen.getByRole("button", { name: /guardar|save/i });
    expect(save).toBeDisabled();
  });

  it("shows an error for password mismatch", async () => {
    render(<ResetPasswordPage token="tok-123" />);

    const [newPw, confirmPw] = screen.getAllByDisplayValue("") as HTMLInputElement[];
    fireEvent.change(newPw, { target: { value: "password123" } });
    fireEvent.change(confirmPw, { target: { value: "different123" } });

    fireEvent.click(
      screen.getByRole("button", { name: /guardar|save/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/las contrase.as no coinciden|passwords.*mismatch/i),
      ).toBeInTheDocument();
    });
  });

  it("shows an error for password shorter than 8 characters", async () => {
    render(<ResetPasswordPage token="tok-123" />);

    const [newPw, confirmPw] = screen.getAllByDisplayValue("") as HTMLInputElement[];
    fireEvent.change(newPw, { target: { value: "1234567" } });
    fireEvent.change(confirmPw, { target: { value: "1234567" } });

    fireEvent.click(
      screen.getByRole("button", { name: /guardar|save/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/m.nimo.*8 caracteres|password.*min.*8|al menos/i),
      ).toBeInTheDocument();
    });
  });

  it("calls authService.resetPassword when fields are valid", async () => {
    mockAuthService.resetPassword = vi.fn().mockResolvedValue(undefined);

    render(<ResetPasswordPage token="tok-123" />);

    const [newPw, confirmPw] = screen.getAllByDisplayValue("") as HTMLInputElement[];
    fireEvent.change(newPw, { target: { value: "newpassword123" } });
    fireEvent.change(confirmPw, { target: { value: "newpassword123" } });

    fireEvent.click(
      screen.getByRole("button", { name: /guardar|save/i }),
    );

    await waitFor(() => {
      expect(mockAuthService.resetPassword).toHaveBeenCalledWith(
        "tok-123",
        "newpassword123",
      );
    });
  });

  it("shows success view after successful reset", async () => {
    mockAuthService.resetPassword = vi.fn().mockResolvedValue(undefined);

    render(<ResetPasswordPage token="tok-123" />);

    const [newPw, confirmPw] = screen.getAllByDisplayValue("") as HTMLInputElement[];
    fireEvent.change(newPw, { target: { value: "newpassword123" } });
    fireEvent.change(confirmPw, { target: { value: "newpassword123" } });

    fireEvent.click(
      screen.getByRole("button", { name: /guardar|save/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/contraseña actualizada/i),
      ).toBeInTheDocument();
    });

    // Back to login button should be visible
    expect(
      screen.getByRole("button", { name: /volver al inicio de sesión|iniciar sesión/i }),
    ).toBeInTheDocument();
  });

  it("dispatches setActiveScreen('login') when back to login is clicked after success", async () => {
    mockAuthService.resetPassword = vi.fn().mockResolvedValue(undefined);

    render(<ResetPasswordPage token="tok-123" />);

    const [newPw, confirmPw] = screen.getAllByDisplayValue("") as HTMLInputElement[];
    fireEvent.change(newPw, { target: { value: "newpassword123" } });
    fireEvent.change(confirmPw, { target: { value: "newpassword123" } });

    fireEvent.click(
      screen.getByRole("button", { name: /guardar|save/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /volver al inicio de sesión|iniciar sesión/i })).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /volver al inicio de sesión|iniciar sesión/i }),
    );

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ui/setActiveScreen",
        payload: "login",
      }),
    );
  });

  it("extracts the token from URL query param when no token prop is given", async () => {
    // Set up window.location.search
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      value: {
        ...originalLocation,
        search: "?token=url-token-abc",
      },
      writable: true,
    });

    mockAuthService.resetPassword = vi.fn().mockResolvedValue(undefined);

    render(<ResetPasswordPage />);

    const [newPw, confirmPw] = screen.getAllByDisplayValue("") as HTMLInputElement[];
    fireEvent.change(newPw, { target: { value: "newpassword123" } });
    fireEvent.change(confirmPw, { target: { value: "newpassword123" } });

    fireEvent.click(
      screen.getByRole("button", { name: /guardar|save/i }),
    );

    await waitFor(() => {
      expect(mockAuthService.resetPassword).toHaveBeenCalledWith(
        "url-token-abc",
        "newpassword123",
      );
    });

    // Restore
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
    });
  });
});
