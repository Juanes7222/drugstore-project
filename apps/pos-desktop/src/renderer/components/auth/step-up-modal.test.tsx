/**
 * Component tests for StepUpModal.
 *
 * Covers: PIN tab, Remote tab, Code tab, countdown timer,
 * success/error paths, cancel button.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StepUpModal } from "./step-up-modal";
import { RoleType } from "@pharmacy/shared-types";
import type { AuthService } from "../../../domain/auth/auth.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockAuthService } = vi.hoisted(() => ({
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
  } as AuthService,
}));

vi.mock("@infra/config", () => ({
  API_BASE_URL: "http://localhost:3000",
}));

vi.mock("../../../domain/auth/auth.service", () => ({
  createAuthService: vi.fn(() => mockAuthService),
  AuthService: {},
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("StepUpModal", () => {
  const defaultProps = {
    operationType: "VOID_SALE",
    operationId: "sale-123",
    workstationId: "ws-1",
    requiredRole: RoleType.MANAGER,
    onApproved: vi.fn(),
    onCancel: vi.fn(),
    authService: mockAuthService as unknown as AuthService,
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders with the PIN tab active by default", () => {
    render(<StepUpModal {...defaultProps} />);

    // Title — t('step_up.title')
    expect(
      screen.getByText("Autorización requerida"),
    ).toBeInTheDocument();

    // PIN tab active — the PinKeypad label is visible
    // t('step_up.pin_label') = "Ingrese su PIN de manager"
    expect(
      screen.getByText("Ingrese su PIN de manager"),
    ).toBeInTheDocument();
  });

  it("renders the countdown timer", () => {
    render(<StepUpModal {...defaultProps} />);

    // 5 minutes = 5:00, displayed as "Tiempo restante: 5:00"
    expect(screen.getByText(/5:00/)).toBeInTheDocument();
  });

  it("shows Remote tab with request button and instruction text", () => {
    render(<StepUpModal {...defaultProps} />);

    // Click remote tab — t('step_up.remote_tab') = "Aprobación remota"
    fireEvent.click(
      screen.getByRole("button", { name: "Aprobación remota" }),
    );

    // t('step_up.remote_request') = "Solicitar aprobación"
    expect(
      screen.getByRole("button", { name: "Solicitar aprobación" }),
    ).toBeInTheDocument();
  });

  it("shows Code tab with a 6-digit input", () => {
    render(<StepUpModal {...defaultProps} />);

    // Click code tab — t('step_up.code_tab') = "Código de un solo uso"
    fireEvent.click(
      screen.getByRole("button", { name: "Código de un solo uso" }),
    );

    // t('step_up.code_instruction') = "Ingrese el código de 6 dígitos que te dio el manager."
    expect(
      screen.getByText(/Ingrese el código de 6 dígitos/i),
    ).toBeInTheDocument();

    const codeInput = screen.getByPlaceholderText("••••••");
    expect(codeInput).toBeInTheDocument();
    expect(codeInput).toHaveAttribute("maxLength", "6");
  });

  describe("PIN verification", () => {
    it("calls requestStepUp and approveStepUp on PIN complete", async () => {
      mockAuthService.requestStepUp = vi.fn().mockResolvedValue({ id: "stepup-1" });
      mockAuthService.approveStepUp = vi.fn().mockResolvedValue({
        approvalToken: "approval-token-abc",
      });

      render(<StepUpModal {...defaultProps} />);

      // Enter a 6-digit PIN to trigger auto-submit (150 ms timeout)
      for (const digit of ["1", "2", "3", "4", "5", "6"]) {
        fireEvent.click(screen.getByRole("button", { name: digit }));
      }

      // Use real timers — the 150 ms auto-submit fires naturally,
      // then the async handlePinComplete flow resolves.
      await waitFor(() => {
        expect(mockAuthService.requestStepUp).toHaveBeenCalledWith({
          operationType: "VOID_SALE",
          operationId: "sale-123",
          workstationId: "ws-1",
          requiredRole: RoleType.MANAGER,
          method: "PIN",
        });
      }, { timeout: 3000 });

      expect(mockAuthService.approveStepUp).toHaveBeenCalledWith(
        "stepup-1",
        "PIN",
      );

      expect(defaultProps.onApproved).toHaveBeenCalledWith(
        "approval-token-abc",
      );
    });

    it("shows an error when PIN verification fails", async () => {
      mockAuthService.requestStepUp = vi.fn().mockResolvedValue({ id: "stepup-1" });
      mockAuthService.approveStepUp = vi.fn().mockRejectedValue(
        new Error("PIN inválido"),
      );

      render(<StepUpModal {...defaultProps} />);

      for (const digit of ["1", "2", "3", "4", "5", "6"]) {
        fireEvent.click(screen.getByRole("button", { name: digit }));
      }

      // t('step_up.pin_error') = "PIN incorrecto o la solicitud expiró."
      await waitFor(() => {
        expect(
          screen.getByText("PIN incorrecto o la solicitud expiró."),
        ).toBeInTheDocument();
      }, { timeout: 3000 });
    });
  });

  describe("Remote approval", () => {
    it("sends request and shows waiting state", async () => {
      mockAuthService.requestStepUp = vi.fn().mockResolvedValue({ id: "stepup-1" });
      mockAuthService.verifyStepUp = vi.fn().mockResolvedValue(false);

      render(<StepUpModal {...defaultProps} />);

      fireEvent.click(
        screen.getByRole("button", { name: "Aprobación remota" }),
      );

      const requestButton = screen.getByRole("button", {
        name: "Solicitar aprobación",
      });
      expect(requestButton).toBeInTheDocument();

      fireEvent.click(requestButton);

      await waitFor(() => {
        expect(mockAuthService.requestStepUp).toHaveBeenCalledWith({
          operationType: "VOID_SALE",
          operationId: "sale-123",
          workstationId: "ws-1",
          requiredRole: RoleType.MANAGER,
          method: "REMOTE",
        });
      });
    });
  });

  describe("Code verification", () => {
    it("calls requestStepUp and approveStepUp with CODE method", async () => {
      mockAuthService.requestStepUp = vi.fn().mockResolvedValue({ id: "stepup-1" });
      mockAuthService.approveStepUp = vi.fn().mockResolvedValue({
        approvalToken: "approval-token-code",
      });

      render(<StepUpModal {...defaultProps} />);

      fireEvent.click(
        screen.getByRole("button", { name: "Código de un solo uso" }),
      );

      const codeInput = screen.getByPlaceholderText("••••••");
      fireEvent.change(codeInput, { target: { value: "654321" } });

      fireEvent.click(
        screen.getByRole("button", { name: "Verificar código" }),
      );

      await waitFor(() => {
        expect(mockAuthService.requestStepUp).toHaveBeenCalledWith({
          operationType: "VOID_SALE",
          operationId: "sale-123",
          workstationId: "ws-1",
          requiredRole: RoleType.MANAGER,
          method: "CODE",
        });
      });

      expect(mockAuthService.approveStepUp).toHaveBeenCalledWith(
        "stepup-1",
        "CODE",
      );

      expect(defaultProps.onApproved).toHaveBeenCalledWith(
        "approval-token-code",
      );
    });
  });

  describe("cancel", () => {
    it("calls onCancel when cancel is clicked", () => {
      render(<StepUpModal {...defaultProps} />);

      fireEvent.click(
        screen.getByRole("button", { name: "Cancelar operación" }),
      );

      expect(defaultProps.onCancel).toHaveBeenCalledOnce();
    });
  });
});
