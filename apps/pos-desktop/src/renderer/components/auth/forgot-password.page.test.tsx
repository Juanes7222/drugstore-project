/**
 * Component tests for ForgotPasswordPage.
 *
 * Covers: email input, cashier info box, submit disabled, success/error states,
 * back-to-login navigation.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ForgotPasswordPage } from "./forgot-password.page";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const dispatch = vi.fn();
const mockForgotPassword = vi.fn();

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

describe("ForgotPasswordPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the email input field", () => {
    render(<ForgotPasswordPage />);

    expect(
      screen.getByPlaceholderText(/usuario@ejemplo.com/i),
    ).toBeInTheDocument();
  });

  it("renders the cashier info box", () => {
    render(<ForgotPasswordPage />);

    expect(screen.getByText(/pídale a su manager|ask.*manager/i)).toBeInTheDocument();
  });

  it("submit button is disabled when email is empty", () => {
    render(<ForgotPasswordPage />);

    const submit = screen.getByRole("button", { name: /enviar enlace|send link/i });
    expect(submit).toBeDisabled();
  });

  it("submit button is enabled when email is filled", () => {
    render(<ForgotPasswordPage />);

    const input = screen.getByPlaceholderText(/usuario@ejemplo.com/i);
    fireEvent.change(input, { target: { value: "user@example.com" } });

    const submit = screen.getByRole("button", { name: /enviar enlace|send link/i });
    expect(submit).not.toBeDisabled();
  });

  it("dispatches setActiveScreen('login') when back to login is clicked", () => {
    render(<ForgotPasswordPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /volver al inicio de sesión|back to login/i }),
    );

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ui/setActiveScreen",
        payload: "login",
      }),
    );
  });

  it("calls authService.forgotPassword on submit", async () => {
    mockAuthService.forgotPassword = vi.fn().mockResolvedValue({
      message: "Revisa tu correo",
    });

    render(<ForgotPasswordPage />);

    const input = screen.getByPlaceholderText(/usuario@ejemplo.com/i);
    fireEvent.change(input, { target: { value: "user@example.com" } });

    fireEvent.click(
      screen.getByRole("button", { name: /enviar enlace|send link/i }),
    );

    await waitFor(() => {
      expect(mockAuthService.forgotPassword).toHaveBeenCalledWith(
        "user@example.com",
      );
    });
  });

  it("shows a success message after successful submission", async () => {
    mockAuthService.forgotPassword = vi.fn().mockResolvedValue({
      message: "Revisa tu correo",
    });

    render(<ForgotPasswordPage />);

    const input = screen.getByPlaceholderText(/usuario@ejemplo.com/i);
    fireEvent.change(input, { target: { value: "user@example.com" } });

    fireEvent.click(
      screen.getByRole("button", { name: /enviar enlace|send link/i }),
    );

    await waitFor(() => {
      expect(screen.getByText("Revisa tu correo")).toBeInTheDocument();
    });
  });

  it("shows an error message when the request fails", async () => {
    mockAuthService.forgotPassword = vi
      .fn()
      .mockRejectedValue(new Error("Network error"));

    render(<ForgotPasswordPage />);

    const input = screen.getByPlaceholderText(/usuario@ejemplo.com/i);
    fireEvent.change(input, { target: { value: "user@example.com" } });

    fireEvent.click(
      screen.getByRole("button", { name: /enviar enlace|send link/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/error al enviar|error.*password/i),
      ).toBeInTheDocument();
    });
  });
});
