/**
 * Component tests for TwoFactorModal.
 *
 * Covers: TOTP mode, backup code mode, input validation, verify button,
 * success/error paths, cancel button.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TwoFactorModal } from "./two-factor-modal";
import type { AuthService } from "../../../domain/auth/auth.service";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("TwoFactorModal", () => {
  const mockAuthService = {
    completeTwoFactor: vi.fn() as any,
  } as unknown as AuthService;

  const defaultProps = {
    challengeToken: "challenge-123",
    authService: mockAuthService,
    onComplete: vi.fn(),
    onCancel: vi.fn(),
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the modal title", () => {
    render(<TwoFactorModal {...defaultProps} />);

    expect(
      screen.getByText(/autenticaci.n de dos factores|two.factor/i),
    ).toBeInTheDocument();
  });

  it("renders in TOTP mode by default", () => {
    render(<TwoFactorModal {...defaultProps} />);

    // TOTP tab should be active (the tab button is rendered)
    expect(
      screen.getByRole("button", { name: /c.digo totp|totp/i }),
    ).toBeInTheDocument();

    // Should show TOTP input (6-digit numeric)
    const totpInput = screen.getByPlaceholderText("••••••");
    expect(totpInput).toBeInTheDocument();
    expect(totpInput).toHaveAttribute("maxLength", "6");
  });

  it("switches to backup code tab when clicked", () => {
    render(<TwoFactorModal {...defaultProps} />);

    fireEvent.click(
      screen.getByRole("button", { name: /c.digo de respaldo|backup code/i }),
    );

    const backupInput = screen.getByPlaceholderText("XXXX-XXXX");
    expect(backupInput).toBeInTheDocument();
  });

  it("TOTP input accepts up to 6 numeric digits and strips non-digits", () => {
    render(<TwoFactorModal {...defaultProps} />);

    const input = screen.getByPlaceholderText("••••••") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "12a34" } });
    // Letters should be stripped
    expect(input.value).toBe("1234");

    fireEvent.change(input, { target: { value: "1234567" } });
    // Should be capped at 6
    expect(input.value).toBe("123456");
  });

  it("verify button is disabled until TOTP code has exactly 6 digits", () => {
    render(<TwoFactorModal {...defaultProps} />);

    const verify = screen.getByRole("button", { name: /verificar|verify/i });

    expect(verify).toBeDisabled();

    const input = screen.getByPlaceholderText("••••••");
    fireEvent.change(input, { target: { value: "12345" } });
    expect(verify).toBeDisabled();

    fireEvent.change(input, { target: { value: "123456" } });
    expect(verify).not.toBeDisabled();
  });

  it("backup code input accepts codes >= 8 chars and verify becomes enabled", () => {
    render(<TwoFactorModal {...defaultProps} />);

    // Switch to backup mode
    fireEvent.click(
      screen.getByRole("button", { name: /c.digo de respaldo|backup code/i }),
    );

    const verify = screen.getByRole("button", { name: /verificar|verify/i });
    expect(verify).toBeDisabled();

    const input = screen.getByPlaceholderText("XXXX-XXXX") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ABCD1234" } });
    expect(input.value).toBe("ABCD1234");
    expect(verify).not.toBeDisabled();
  });

  it("calls authService.completeTwoFactor with TOTP code on verify", async () => {
    mockAuthService.completeTwoFactor = vi.fn() as any;

    render(<TwoFactorModal {...defaultProps} />);

    const input = screen.getByPlaceholderText("••••••");
    fireEvent.change(input, { target: { value: "123456" } });

    fireEvent.click(
      screen.getByRole("button", { name: /verificar|verify/i }),
    );

    await waitFor(() => {
      expect(mockAuthService.completeTwoFactor).toHaveBeenCalledWith(
        "challenge-123",
        "123456",
        undefined,
      );
    });

    expect(defaultProps.onComplete).toHaveBeenCalled();
  });

  it("calls authService.completeTwoFactor with backup code on verify", async () => {
    mockAuthService.completeTwoFactor = vi.fn() as any;

    render(<TwoFactorModal {...defaultProps} />);

    fireEvent.click(
      screen.getByRole("button", { name: /c.digo de respaldo|backup code/i }),
    );

    const input = screen.getByPlaceholderText("XXXX-XXXX");
    fireEvent.change(input, { target: { value: "ABCD1234" } });

    fireEvent.click(
      screen.getByRole("button", { name: /verificar|verify/i }),
    );

    await waitFor(() => {
      expect(mockAuthService.completeTwoFactor).toHaveBeenCalledWith(
        "challenge-123",
        undefined,
        "ABCD1234",
      );
    });

    expect(defaultProps.onComplete).toHaveBeenCalled();
  });

  it("shows an error message when verification fails", async () => {
    mockAuthService.completeTwoFactor = vi.fn().mockRejectedValue(new Error("Código inválido")) as any;

    render(<TwoFactorModal {...defaultProps} />);

    const input = screen.getByPlaceholderText("••••••");
    fireEvent.change(input, { target: { value: "000000" } });

    fireEvent.click(
      screen.getByRole("button", { name: /verificar|verify/i }),
    );

    await waitFor(() => {
      expect(screen.getByText("Código inválido")).toBeInTheDocument();
    });
  });

  it("calls onCancel when the cancel button is clicked", () => {
    render(<TwoFactorModal {...defaultProps} />);

    fireEvent.click(
      screen.getByRole("button", { name: /cancelar|cancel/i }),
    );

    expect(defaultProps.onCancel).toHaveBeenCalledOnce();
  });

  it("shows loading state (verifying) on the verify button during verification", async () => {
    mockAuthService.completeTwoFactor = vi.fn(
      () => new Promise(() => {}), // never resolves
    ) as any;

    render(<TwoFactorModal {...defaultProps} />);

    const input = screen.getByPlaceholderText("••••••");
    fireEvent.change(input, { target: { value: "123456" } });

    fireEvent.click(
      screen.getByRole("button", { name: /verificar|verify/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/verificando|verifying/i)).toBeInTheDocument();
    });
  });
});
