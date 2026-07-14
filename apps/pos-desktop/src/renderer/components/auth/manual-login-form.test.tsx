/**
 * Component tests for ManualLoginForm.
 *
 * Covers: rendering inputs, change handlers, submit via button and
 * Enter key, back button, and loading state.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ManualLoginForm } from "./manual-login-form";

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------

const defaultProps = {
  identifier: "",
  password: "",
  isLoading: false,
  onIdentifierChange: vi.fn(),
  onPasswordChange: vi.fn(),
  onSubmit: vi.fn(),
  onBack: vi.fn(),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ManualLoginForm", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders identifier and password labels from translation", () => {
    render(<ManualLoginForm {...defaultProps} />);

    expect(screen.getByText("Correo o usuario")).toBeInTheDocument();
    expect(screen.getByText("Contraseña")).toBeInTheDocument();
  });

  it("renders input fields with correct values", () => {
    render(
      <ManualLoginForm
        {...defaultProps}
        identifier="test@example.com"
        password="s3cret"
      />,
    );

    const identifierInput = screen.getByPlaceholderText("usuario@ejemplo.com");
    expect(identifierInput).toHaveValue("test@example.com");

    const passwordInput = screen.getByPlaceholderText("••••••••");
    expect(passwordInput).toHaveValue("s3cret");
  });

  it("calls onIdentifierChange when the identifier input changes", () => {
    const onIdentifierChange = vi.fn();
    render(
      <ManualLoginForm
        {...defaultProps}
        onIdentifierChange={onIdentifierChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("usuario@ejemplo.com"), {
      target: { value: "admin" },
    });
    expect(onIdentifierChange).toHaveBeenCalledWith("admin");
  });

  it("calls onPasswordChange when the password input changes", () => {
    const onPasswordChange = vi.fn();
    render(
      <ManualLoginForm
        {...defaultProps}
        onPasswordChange={onPasswordChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "mypassword" },
    });
    expect(onPasswordChange).toHaveBeenCalledWith("mypassword");
  });

  it("calls onSubmit when the submit button is clicked", () => {
    const onSubmit = vi.fn();
    render(
      <ManualLoginForm
        {...defaultProps}
        identifier="test"
        password="pass"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByText("Ingresar"));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("calls onSubmit when Enter is pressed in the password field", () => {
    const onSubmit = vi.fn();
    render(
      <ManualLoginForm
        {...defaultProps}
        identifier="test"
        password="pass"
        onSubmit={onSubmit}
      />,
    );

    const passwordInput = screen.getByPlaceholderText("••••••••");
    fireEvent.keyDown(passwordInput, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("disables the submit button when identifier or password is empty", () => {
    const { rerender } = render(<ManualLoginForm {...defaultProps} />);

    // Both empty
    expect(
      screen.getByRole("button", { name: "Ingresar" }),
    ).toBeDisabled();

    // Only identifier filled
    rerender(
      <ManualLoginForm {...defaultProps} identifier="test" />,
    );
    expect(
      screen.getByRole("button", { name: "Ingresar" }),
    ).toBeDisabled();

    // Only password filled
    rerender(
      <ManualLoginForm {...defaultProps} password="pass" />,
    );
    expect(
      screen.getByRole("button", { name: "Ingresar" }),
    ).toBeDisabled();
  });

  it("enables the submit button when both fields have values", () => {
    render(
      <ManualLoginForm
        {...defaultProps}
        identifier="test"
        password="pass"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Ingresar" }),
    ).not.toBeDisabled();
  });

  it("shows signing-in text and disables the button when loading", () => {
    render(
      <ManualLoginForm
        {...defaultProps}
        identifier="test"
        password="pass"
        isLoading
      />,
    );

    expect(screen.getByText("Ingresando...")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ingresando..." }),
    ).toBeDisabled();
  });

  it("calls onBack when the back button is clicked", () => {
    const onBack = vi.fn();
    render(<ManualLoginForm {...defaultProps} onBack={onBack} />);

    fireEvent.click(screen.getByText("Seleccionar usuario"));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
