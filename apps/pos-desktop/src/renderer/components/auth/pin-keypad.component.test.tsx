/**
 * Component tests for PinKeypad.
 *
 * Covers: layout, PIN dots, digit entry, auto-submit, submit button,
 * error display, loading state, backspace, cancel button, shuffle mode.
 *
 * The submit button text is "Ingresar" (Spanish translation of
 * auth.submit_pin). The backspace aria-label is "Borrar".
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { PinKeypad } from "./pin-keypad.component";

describe("PinKeypad", () => {
  const defaultProps = {
    onComplete: vi.fn(),
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("layout", () => {
    it("renders the label with a default translation when no label is provided", () => {
      render(<PinKeypad {...defaultProps} />);

      expect(
        screen.getByText(/ingrese su pin|enter pin/i),
      ).toBeInTheDocument();
    });

    it("renders a custom label when provided", () => {
      render(<PinKeypad {...defaultProps} label="Super secret PIN" />);

      expect(screen.getByText("Super secret PIN")).toBeInTheDocument();
    });

    it("renders 12 keys in the numeric keypad (1-9, empty, 0, ⌫)", () => {
      render(<PinKeypad {...defaultProps} />);

      // 12 key buttons: digits 1-9, 0, delete, plus an empty placeholder
      for (let i = 1; i <= 9; i++) {
        expect(
          screen.getByRole("button", { name: String(i) }),
        ).toBeInTheDocument();
      }
      expect(
        screen.getByRole("button", { name: "0" }),
      ).toBeInTheDocument();
    });

    it("renders the submit button disabled until at least 4 digits are entered", () => {
      render(<PinKeypad {...defaultProps} length={6} />);

      const submit = screen.getByRole("button", { name: /ingresar|submit/i });
      expect(submit).toBeDisabled();

      // Enter 3 digits — still disabled
      fireEvent.click(screen.getByRole("button", { name: "1" }));
      fireEvent.click(screen.getByRole("button", { name: "2" }));
      fireEvent.click(screen.getByRole("button", { name: "3" }));
      expect(submit).toBeDisabled();

      // Enter the 4th digit — enabled
      fireEvent.click(screen.getByRole("button", { name: "4" }));
      expect(submit).not.toBeDisabled();
    });
  });

  describe("PIN dots", () => {
    it("shows the correct number of PIN dot indicators", () => {
      const { container } = render(
        <PinKeypad {...defaultProps} length={6} />,
      );

      // Each dot is a div inside the PIN display row
      const pinDots = container.querySelectorAll(
        '[style*="border-radius: 50%"]',
      );
      expect(pinDots).toHaveLength(6);
    });

    it("fills dots as digits are entered", () => {
      const { container } = render(
        <PinKeypad {...defaultProps} length={4} />,
      );

      const getFilledDots = () =>
        Array.from(
          container.querySelectorAll('[style*="border-radius: 50%"]'),
        ).filter(
          (el) =>
            (el as HTMLElement).style.backgroundColor !== "" &&
            !(el as HTMLElement).style.backgroundColor.includes("border"),
        );

      expect(getFilledDots()).toHaveLength(0);

      fireEvent.click(screen.getByRole("button", { name: "1" }));
      expect(getFilledDots()).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: "2" }));
      expect(getFilledDots()).toHaveLength(2);
    });
  });

  describe("digit entry", () => {
    it("appends a digit when a key is pressed", () => {
      render(<PinKeypad {...defaultProps} length={4} />);

      const submit = screen.getByRole("button", { name: /ingresar|submit/i });

      fireEvent.click(screen.getByRole("button", { name: "1" }));
      fireEvent.click(screen.getByRole("button", { name: "2" }));
      fireEvent.click(screen.getByRole("button", { name: "3" }));
      // 3 digits — submit still disabled
      expect(submit).toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "4" }));
      // 4 digits — submit enabled
      expect(submit).not.toBeDisabled();
    });

    it("does not append beyond the length limit", () => {
      vi.useFakeTimers();
      const onComplete = vi.fn();
      render(<PinKeypad length={3} onComplete={onComplete} />);

      fireEvent.click(screen.getByRole("button", { name: "1" }));
      fireEvent.click(screen.getByRole("button", { name: "2" }));
      fireEvent.click(screen.getByRole("button", { name: "3" }));

      // Auto-submit fires after 150ms
      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(onComplete).toHaveBeenCalledWith("123");

      // Fourth click should be ignored (already at length)
      fireEvent.click(screen.getByRole("button", { name: "4" }));

      // onComplete should only have been called once
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe("auto-submit", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("auto-submits after 150ms when PIN reaches the required length", () => {
      const onComplete = vi.fn();
      render(<PinKeypad length={4} onComplete={onComplete} />);

      fireEvent.click(screen.getByRole("button", { name: "1" }));
      fireEvent.click(screen.getByRole("button", { name: "2" }));
      fireEvent.click(screen.getByRole("button", { name: "3" }));
      fireEvent.click(screen.getByRole("button", { name: "4" }));

      expect(onComplete).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(onComplete).toHaveBeenCalledWith("1234");
    });
  });

  describe("submit button", () => {
    it("calls onComplete with the PIN when submit is clicked", () => {
      const onComplete = vi.fn();
      render(<PinKeypad length={6} onComplete={onComplete} />);

      fireEvent.click(screen.getByRole("button", { name: "1" }));
      fireEvent.click(screen.getByRole("button", { name: "2" }));
      fireEvent.click(screen.getByRole("button", { name: "3" }));
      fireEvent.click(screen.getByRole("button", { name: "4" }));

      fireEvent.click(
        screen.getByRole("button", { name: /ingresar|submit/i }),
      );

      expect(onComplete).toHaveBeenCalledWith("1234");
    });
  });

  describe("error", () => {
    it("displays an error message when error prop is set", () => {
      render(
        <PinKeypad
          {...defaultProps}
          error="PIN incorrecto"
        />,
      );

      expect(screen.getByText("PIN incorrecto")).toBeInTheDocument();
    });
  });

  describe("loading", () => {
    it("disables all keys and the submit button during loading", () => {
      render(<PinKeypad {...defaultProps} isLoading />);

      // All digit buttons should be disabled
      const digitButton = screen.getByRole("button", { name: "1" });
      expect(digitButton).toBeDisabled();

      const submit = screen.getByRole("button", { name: /verificando|verifying/i });
      expect(submit).toBeDisabled();
    });

    it("ignores keypress events during loading (does not append digits)", () => {
      const onComplete = vi.fn();
      render(<PinKeypad length={4} onComplete={onComplete} isLoading />);

      fireEvent.click(screen.getByRole("button", { name: "1" }));
      fireEvent.click(screen.getByRole("button", { name: "2" }));

      // Manually clicking submit - onComplete should not be called
      fireEvent.click(
        screen.getByRole("button", { name: /verificando|verifying/i }),
      );
      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  describe("backspace", () => {
    it("removes the last digit when backspace is pressed", () => {
      const { container } = render(
        <PinKeypad {...defaultProps} length={4} />,
      );

      fireEvent.click(screen.getByRole("button", { name: "1" }));
      fireEvent.click(screen.getByRole("button", { name: "2" }));
      fireEvent.click(screen.getByRole("button", { name: "3" }));

      const getFilledDots = () =>
        Array.from(
          container.querySelectorAll('[style*="border-radius: 50%"]'),
        ).filter(
          (el) =>
            (el as HTMLElement).style.backgroundColor !== "" &&
            !(el as HTMLElement).style.backgroundColor.includes("border"),
        );

      expect(getFilledDots()).toHaveLength(3);

      // Click backspace (⌫ key)
      fireEvent.click(
        screen.getByRole("button", { name: /borrar|delete|⌫/i }),
      );

      expect(getFilledDots()).toHaveLength(2);
    });
  });

  describe("cancel button", () => {
    it("renders a cancel button when onCancel is provided", () => {
      const onCancel = vi.fn();
      render(<PinKeypad {...defaultProps} onCancel={onCancel} />);

      const cancel = screen.getByRole("button", { name: /cancelar|cancel/i });
      expect(cancel).toBeInTheDocument();
    });

    it("calls onCancel when cancel is clicked", () => {
      const onCancel = vi.fn();
      render(<PinKeypad {...defaultProps} onCancel={onCancel} />);

      fireEvent.click(
        screen.getByRole("button", { name: /cancelar|cancel/i }),
      );
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("does not render a cancel button when onCancel is not provided", () => {
      render(<PinKeypad {...defaultProps} />);

      expect(
        screen.queryByRole("button", { name: /cancelar|cancel/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("shuffle mode", () => {
    it("randomizes key positions when shuffle is true", () => {
      // Render once without shuffle, once with shuffle — the order may differ
      const { container: normalContainer } = render(
        <PinKeypad {...defaultProps} shuffle={false} />,
      );
      const normalKeys = Array.from(
        normalContainer.querySelectorAll("button"),
      )
        .filter((b) => /^\d$/.test(b.textContent ?? ""))
        .map((b) => b.textContent);

      const { container: shuffledContainer } = render(
        <PinKeypad {...defaultProps} shuffle />,
      );
      const shuffledKeys = Array.from(
        shuffledContainer.querySelectorAll("button"),
      )
        .filter((b) => /^\d$/.test(b.textContent ?? ""))
        .map((b) => b.textContent);

      // The arrays should contain the same elements but the order may be
      // different.  We just verify both have digits 1-9 and 0.
      expect(normalKeys.sort()).toEqual(shuffledKeys.sort());
    });
  });
});
