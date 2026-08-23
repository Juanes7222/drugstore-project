/**
 * Component tests for CheckoutResult — the certificate preview note shown
 * on approved checkouts of CERTIFICATE plans (and only there).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheckoutResult, type CheckoutResultProps } from "./checkout-result";

const makeProps = (
  overrides: Partial<CheckoutResultProps> = {},
): CheckoutResultProps => ({
  kind: "approved",
  activationCode: "ABCDEFGHIJKL",
  requiresCertificate: false,
  onActivate: vi.fn(),
  onRetryPayment: vi.fn(),
  onRestart: vi.fn(),
  onDismissCode: vi.fn(),
  ...overrides,
});

describe("CheckoutResult", () => {
  it("shows the certificate preview note when requiresCertificate is set", () => {
    render(
      <CheckoutResult {...makeProps({ requiresCertificate: true })} />,
    );

    expect(screen.getByRole("note")).toHaveTextContent(
      /Siguiente: tu certificado DIAN/,
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      /subirás tu certificado digital/,
    );
  });

  it("renders no certificate note without the requiresCertificate prop", () => {
    render(<CheckoutResult {...makeProps()} />);

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Siguiente: tu certificado DIAN/),
    ).not.toBeInTheDocument();
  });

  it("never shows the certificate note on a declined checkout", () => {
    render(
      <CheckoutResult
        {...makeProps({ kind: "declined", requiresCertificate: true })}
      />,
    );

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("never shows the certificate note on a timed-out checkout", () => {
    render(
      <CheckoutResult
        {...makeProps({ kind: "timeout", requiresCertificate: true })}
      />,
    );

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});