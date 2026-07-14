/**
 * Component tests for SelectedUserCredential.
 *
 * Covers: user info display, role-based credential entry (PinKeypad vs.
 * password form), change user button, forgot password link, error and
 * countdown display.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RoleType } from "@pharmacy/shared-types";
import { SelectedUserCredential } from "./selected-user-credential";
import type { LocalUserInfo } from "../../../domain/auth/local-users";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const cashierUser: LocalUserInfo = {
  id: "cashier-1",
  displayName: "Carlos López",
  role: RoleType.CASHIER,
  avatarUrl: null,
  avatarColor: "#D97706",
  username: "carlos.lopez",
};

const managerUser: LocalUserInfo = {
  id: "manager-1",
  displayName: "María García",
  role: RoleType.MANAGER,
  avatarUrl: null,
  avatarColor: "#059669",
  username: "maria.garcia",
};

const ownerUser: LocalUserInfo = {
  id: "owner-1",
  displayName: "Juan Pérez",
  role: RoleType.OWNER,
  avatarUrl: null,
  avatarColor: "#4F46E5",
  username: "juan.perez",
};

const defaultProps = {
  user: cashierUser,
  password: "",
  error: null,
  isLoading: false,
  countdown: 0,
  onPasswordChange: vi.fn(),
  onPinComplete: vi.fn(),
  onPasswordSubmit: vi.fn(),
  onChangeUser: vi.fn(),
  onForgotPassword: vi.fn(),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SelectedUserCredential", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the selected user's display name and translated role", () => {
    render(<SelectedUserCredential {...defaultProps} />);

    expect(screen.getByText("Carlos López")).toBeInTheDocument();
    expect(screen.getByText("Cajero")).toBeInTheDocument();
  });

  it("renders change-user button with correct accessible name and calls onChangeUser", () => {
    const onChangeUser = vi.fn();
    render(
      <SelectedUserCredential
        {...defaultProps}
        onChangeUser={onChangeUser}
      />,
    );

    const changeBtn = screen.getByRole("button", {
      name: "Cambiar usuario",
    });
    expect(changeBtn).toBeInTheDocument();

    fireEvent.click(changeBtn);
    expect(onChangeUser).toHaveBeenCalledOnce();
  });

  describe("for CASHIER or MANAGER", () => {
    it("renders PinKeypad for a CASHIER user", () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={cashierUser}
        />,
      );

      // PinKeypad renders the label from translation
      expect(
        screen.getByText("Ingrese su PIN"),
      ).toBeInTheDocument();
    });

    it("renders PinKeypad with manager label for a MANAGER user", () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={managerUser}
        />,
      );

      expect(
        screen.getByText("Ingrese su PIN de manager"),
      ).toBeInTheDocument();
    });

    it("renders the pin error when error is provided", () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={cashierUser}
          error="PIN incorrecto"
        />,
      );

      expect(screen.getByText("PIN incorrecto")).toBeInTheDocument();
    });

    it("does not render password-specific elements", () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={cashierUser}
        />,
      );

      expect(
        screen.queryByText("Olvidé mi contraseña"),
      ).not.toBeInTheDocument();
    });
  });

  describe("for OWNER (password entry)", () => {
    it("renders password input with label from translation", () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
        />,
      );

      expect(screen.getByText("Contraseña")).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("••••••••"),
      ).toBeInTheDocument();
    });

    it("calls onPasswordChange when the password input changes", () => {
      const onPasswordChange = vi.fn();
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
          onPasswordChange={onPasswordChange}
        />,
      );

      fireEvent.change(screen.getByPlaceholderText("••••••••"), {
        target: { value: "newpass" },
      });
      expect(onPasswordChange).toHaveBeenCalledWith("newpass");
    });

    it("calls onPasswordSubmit when Enter is pressed in the password field", () => {
      const onPasswordSubmit = vi.fn();
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
          onPasswordSubmit={onPasswordSubmit}
        />,
      );

      fireEvent.keyDown(screen.getByPlaceholderText("••••••••"), {
        key: "Enter",
      });
      expect(onPasswordSubmit).toHaveBeenCalledOnce();
    });

    it("renders forgot-password button and calls onForgotPassword", () => {
      const onForgotPassword = vi.fn();
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
          onForgotPassword={onForgotPassword}
        />,
      );

      const forgotBtn = screen.getByText("Olvidé mi contraseña");
      expect(forgotBtn).toBeInTheDocument();

      fireEvent.click(forgotBtn);
      expect(onForgotPassword).toHaveBeenCalledOnce();
    });

    it("disables submit button when password is empty", () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
          password=""
        />,
      );

      expect(
        screen.getByRole("button", { name: "Ingresar" }),
      ).toBeDisabled();
    });

    it("enables submit button when password is non-empty", () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
          password="secret"
        />,
      );

      expect(
        screen.getByRole("button", { name: "Ingresar" }),
      ).not.toBeDisabled();
    });

    it("shows signing-in text and disables button when loading", () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
          password="secret"
          isLoading
        />,
      );

      expect(screen.getByText("Ingresando...")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Ingresando..." }),
      ).toBeDisabled();
    });

    it("displays error text in the password section", () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
          error="Usuario o contraseña incorrectos."
        />,
      );

      expect(
        screen.getByText("Usuario o contraseña incorrectos."),
      ).toBeInTheDocument();
    });

    it("displays lockout countdown when countdown > 0", () => {
      render(
        <SelectedUserCredential
          {...defaultProps}
          user={ownerUser}
          password="secret"
          countdown={125}
        />,
      );

      // 125 seconds → 2 minutes 5 seconds → "Vuelva a intentar en 2:05"
      expect(
        screen.getByText(/Vuelva a intentar en 2:05/),
      ).toBeInTheDocument();
    });
  });
});
