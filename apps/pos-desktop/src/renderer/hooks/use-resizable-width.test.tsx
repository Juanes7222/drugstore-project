/**
 * Tests for useResizableWidth.
 *
 * The hook reads/writes the real user preferences store (it resets its own
 * state in beforeEach), so persistence between "sessions" is covered by
 * writing to the store and re-rendering a fresh harness.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useUserPreferencesStore } from "../../stores/user-preferences.store";
import { useResizableWidth } from "./use-resizable-width";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function Harness({
  storageKey = "test-panel",
  defaultWidth = 480,
  minWidth = 320,
  maxWidth = 960,
  label = "Resize panel",
}: {
  storageKey?: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  label?: string;
}) {
  const { width, isResizing, handleProps } = useResizableWidth({
    storageKey,
    defaultWidth,
    minWidth,
    maxWidth,
    label,
  });

  return (
    <div>
      <div data-testid="width">{width}</div>
      <div data-testid="resizing">{String(isResizing)}</div>
      <div data-testid="handle" {...handleProps} />
    </div>
  );
}

function getHandle() {
  return screen.getByTestId("handle");
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useResizableWidth", () => {
  beforeEach(() => {
    useUserPreferencesStore.setState({ panelWidths: {} });
  });

  describe("initial width", () => {
    it("uses the default width when nothing is persisted", () => {
      render(<Harness defaultWidth={480} />);

      expect(screen.getByTestId("width")).toHaveTextContent("480");
    });

    it("uses the persisted width when one exists", () => {
      useUserPreferencesStore.getState().setPanelWidth("test-panel", 640);

      render(<Harness />);

      expect(screen.getByTestId("width")).toHaveTextContent("640");
    });

    it("clamps the persisted width to [minWidth, maxWidth]", () => {
      useUserPreferencesStore.getState().setPanelWidth("test-panel", 2000);

      render(<Harness minWidth={320} maxWidth={960} />);

      expect(screen.getByTestId("width")).toHaveTextContent("960");
    });
  });

  describe("handle element props", () => {
    it("exposes an accessible separator role with value metadata", () => {
      render(<Harness label="Ajustar ancho" />);

      const handle = getHandle();
      expect(handle).toHaveAttribute("role", "separator");
      expect(handle).toHaveAttribute("aria-orientation", "vertical");
      expect(handle).toHaveAttribute("aria-label", "Ajustar ancho");
      expect(handle).toHaveAttribute("aria-valuenow", "480");
      expect(handle).toHaveAttribute("aria-valuemin", "320");
      expect(handle).toHaveAttribute("aria-valuemax", "960");
      expect(handle).toHaveAttribute("tabindex", "0");
    });

    it("updates aria-valuenow as the width changes", () => {
      render(<Harness />);

      fireEvent.keyDown(getHandle(), { key: "ArrowRight" });

      expect(getHandle()).toHaveAttribute("aria-valuenow", "496");
    });
  });

  describe("pointer drag", () => {
    it("widens the panel when dragging the handle to the left", () => {
      render(<Harness defaultWidth={480} />);

      fireEvent.pointerDown(getHandle(), { button: 0, clientX: 500 });
      fireEvent.pointerMove(getHandle(), { clientX: 400 });
      fireEvent.pointerMove(getHandle(), { clientX: 350 });

      expect(screen.getByTestId("width")).toHaveTextContent("630");
    });

    it("narrows the panel when dragging the handle to the right", () => {
      render(<Harness defaultWidth={480} />);

      fireEvent.pointerDown(getHandle(), { button: 0, clientX: 500 });
      fireEvent.pointerMove(getHandle(), { clientX: 600 });

      expect(screen.getByTestId("width")).toHaveTextContent("380");
    });

    it("flags isResizing only while a drag is in progress", () => {
      render(<Harness />);

      expect(screen.getByTestId("resizing")).toHaveTextContent("false");

      fireEvent.pointerDown(getHandle(), { button: 0, clientX: 500 });
      expect(screen.getByTestId("resizing")).toHaveTextContent("true");

      fireEvent.pointerUp(getHandle(), { button: 0, clientX: 500 });
      expect(screen.getByTestId("resizing")).toHaveTextContent("false");
    });

    it("persists the final width to the store on pointer up", () => {
      render(<Harness />);

      fireEvent.pointerDown(getHandle(), { button: 0, clientX: 500 });
      fireEvent.pointerMove(getHandle(), { clientX: 300 });
      fireEvent.pointerUp(getHandle(), { button: 0, clientX: 300 });

      expect(
        useUserPreferencesStore.getState().panelWidths["test-panel"],
      ).toBe(680);
    });

    it("clamps while dragging beyond maxWidth", () => {
      render(<Harness defaultWidth={480} minWidth={320} maxWidth={600} />);

      fireEvent.pointerDown(getHandle(), { button: 0, clientX: 500 });
      fireEvent.pointerMove(getHandle(), { clientX: -1000 });

      expect(screen.getByTestId("width")).toHaveTextContent("600");
    });
  });

  describe("keyboard", () => {
    it("narrows with ArrowLeft and widens with ArrowRight by 16px", () => {
      render(<Harness defaultWidth={480} />);

      fireEvent.keyDown(getHandle(), { key: "ArrowLeft" });
      expect(screen.getByTestId("width")).toHaveTextContent("464");

      fireEvent.keyDown(getHandle(), { key: "ArrowRight" });
      expect(screen.getByTestId("width")).toHaveTextContent("480");
    });

    it("uses a 48px step with Shift held", () => {
      render(<Harness defaultWidth={480} />);

      fireEvent.keyDown(getHandle(), { key: "ArrowRight", shiftKey: true });
      expect(screen.getByTestId("width")).toHaveTextContent("528");
    });

    it("jumps to min with Home and max with End", () => {
      render(<Harness minWidth={320} maxWidth={960} />);

      fireEvent.keyDown(getHandle(), { key: "Home" });
      expect(screen.getByTestId("width")).toHaveTextContent("320");

      fireEvent.keyDown(getHandle(), { key: "End" });
      expect(screen.getByTestId("width")).toHaveTextContent("960");
    });

    it("persists keyboard adjustments immediately", () => {
      render(<Harness />);

      fireEvent.keyDown(getHandle(), { key: "ArrowRight" });

      expect(
        useUserPreferencesStore.getState().panelWidths["test-panel"],
      ).toBe(496);
    });

    it("does nothing for unrelated keys", () => {
      render(<Harness defaultWidth={480} />);

      fireEvent.keyDown(getHandle(), { key: "Enter" });

      expect(screen.getByTestId("width")).toHaveTextContent("480");
    });
  });

  describe("double click", () => {
    it("resets the width to the default and persists it", () => {
      useUserPreferencesStore.getState().setPanelWidth("test-panel", 800);
      render(<Harness defaultWidth={480} />);

      expect(screen.getByTestId("width")).toHaveTextContent("800");

      fireEvent.doubleClick(getHandle());

      expect(screen.getByTestId("width")).toHaveTextContent("480");
      expect(
        useUserPreferencesStore.getState().panelWidths["test-panel"],
      ).toBe(480);
    });
  });

  describe("per-panel keys", () => {
    it("restores the width for a different panel key independently", () => {
      useUserPreferencesStore.getState().setPanelWidth("other-panel", 720);

      render(<Harness storageKey="test-panel" defaultWidth={480} />);

      expect(screen.getByTestId("width")).toHaveTextContent("480");
    });
  });
});
