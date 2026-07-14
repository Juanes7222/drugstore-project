/**
 * Component tests for OperationQueuedToast.
 *
 * Covers: online/offline visual state, auto-dismiss, manual dismiss,
 * truncated UUID, and unverified tag.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { OperationQueuedToast } from "./operation-queued-toast";

const defaultProps = {
  operationUuid: "abc-123-def-456",
  operationType: "CLIENT_RETURN",
  isOnline: true,
  onDismiss: vi.fn(),
};

describe("OperationQueuedToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("OQT-01: online mode", () => {
    it("shows the synced status label when online", () => {
      render(<OperationQueuedToast {...defaultProps} isOnline={true} />);

      expect(screen.getByText("Operación sincronizada")).toBeInTheDocument();
    });
  });

  describe("OQT-02: offline mode", () => {
    it("shows the queued status label when offline", () => {
      render(<OperationQueuedToast {...defaultProps} isOnline={false} />);

      expect(screen.getByText("Operación en cola para sincronizar")).toBeInTheDocument();
    });
  });

  describe("OQT-03: auto-dismiss", () => {
    it("calls onDismiss after the default 5 000 ms", () => {
      const onDismiss = vi.fn();
      render(
        <OperationQueuedToast
          {...defaultProps}
          onDismiss={onDismiss}
          autoDismissMs={5_000}
        />,
      );

      expect(onDismiss).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(5_000);
      });

      // handleClose schedules a second setTimeout(onDismiss, 200) for exit animation
      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it("calls onDismiss after a custom autoDismissMs duration", () => {
      const onDismiss = vi.fn();
      render(
        <OperationQueuedToast
          {...defaultProps}
          onDismiss={onDismiss}
          autoDismissMs={2_000}
        />,
      );

      act(() => {
        vi.advanceTimersByTime(2_000);
      });

      // handleClose schedules a second setTimeout(onDismiss, 200) for exit animation
      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it("does not call onDismiss before the timeout elapses", () => {
      const onDismiss = vi.fn();
      render(
        <OperationQueuedToast
          {...defaultProps}
          onDismiss={onDismiss}
          autoDismissMs={5_000}
        />,
      );

      act(() => {
        vi.advanceTimersByTime(3_000);
      });

      expect(onDismiss).not.toHaveBeenCalled();
    });
  });

  describe("OQT-04: manual dismiss", () => {
    it("calls onDismiss after a 200 ms delay when the close button is clicked", () => {
      const onDismiss = vi.fn();
      render(<OperationQueuedToast {...defaultProps} onDismiss={onDismiss} />);

      fireEvent.click(screen.getByRole("button", { name: /cerrar/i }));

      // The handleClose sets isExiting=true and schedules onDismiss after 200ms
      expect(onDismiss).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(onDismiss).toHaveBeenCalledOnce();
    });
  });

  describe("unverified tag", () => {
    it("shows the warning label when isVerified is false", () => {
      render(
        <OperationQueuedToast
          {...defaultProps}
          isVerified={false}
        />,
      );

      expect(screen.getByText("No verificado - el servidor reconciliará")).toBeInTheDocument();
    });

    it("does not render the warning label when isVerified is true", () => {
      render(
        <OperationQueuedToast
          {...defaultProps}
          isVerified={true}
        />,
      );

      expect(screen.queryByText("No verificado - el servidor reconciliará")).not.toBeInTheDocument();
    });
  });

  describe("UUID truncation", () => {
    it("truncates long UUIDs to 8 characters with ellipsis", () => {
      render(
        <OperationQueuedToast
          {...defaultProps}
          operationUuid="very-long-uuid-string-here"
        />,
      );

      expect(screen.getByText("very-lon...")).toBeInTheDocument();
    });

    it("shows the full UUID when it is 8 characters or fewer", () => {
      render(
        <OperationQueuedToast
          {...defaultProps}
          operationUuid="short"
        />,
      );

      expect(screen.getByText("short")).toBeInTheDocument();
    });
  });

  it("has a status role for accessibility", () => {
    render(<OperationQueuedToast {...defaultProps} />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders the operation type label from i18n", () => {
    render(<OperationQueuedToast {...defaultProps} />);

    expect(screen.getByText("Devolución", { exact: false })).toBeInTheDocument();
  });
});
