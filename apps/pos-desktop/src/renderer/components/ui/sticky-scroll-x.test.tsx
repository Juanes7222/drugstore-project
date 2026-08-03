/**
 * Tests for StickyScrollX.
 *
 * jsdom cannot compute layout, so scrollWidth/clientWidth default to 0 and
 * the ResizeObserver stub in vitest.setup never fires. These tests override
 * both to drive the overflow detection and the scroll sync behaviour.
 */
import { type ReactNode, act } from "react";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StickyScrollX } from "./sticky-scroll-x";

// ---------------------------------------------------------------------------
// Controllable ResizeObserver
// ---------------------------------------------------------------------------

type ROCallback = (entries: ResizeObserverEntry[]) => void;

class MockResizeObserver implements ResizeObserver {
  static instances: MockResizeObserver[] = [];
  callback: ROCallback;

  constructor(callback: ROCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}

  /** Fire the stored callback so the component re-measures. */
  emit(): void {
    this.callback([]);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalRO = globalThis.ResizeObserver;

function installMockRO(): void {
  MockResizeObserver.instances = [];
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}

function restoreRO(): void {
  globalThis.ResizeObserver = originalRO;
}

/** Force the viewport to report a horizontal overflow and re-measure. */
function forceOverflow(viewport: HTMLElement, scrollWidth = 1000): void {
  Object.defineProperty(viewport, "clientWidth", {
    configurable: true,
    value: 400,
  });
  Object.defineProperty(viewport, "scrollWidth", {
    configurable: true,
    value: scrollWidth,
  });
  act(() => {
    MockResizeObserver.instances.forEach((ro) => ro.emit());
  });
}

function renderTable(content: ReactNode): HTMLElement {
  render(
    <StickyScrollX>
      <table data-testid="table">{content}</table>
    </StickyScrollX>,
  );
  return screen.getByTestId("table");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StickyScrollX", () => {
  beforeEach(() => {
    installMockRO();
  });

  afterEach(() => {
    restoreRO();
  });

  it("renders children and no sticky bar when content fits", () => {
    const table = renderTable(<tbody><tr><td>ok</td></tr></tbody>);
    expect(table).toBeInTheDocument();
    expect(screen.queryByTestId("sticky-scroll-bar")).not.toBeInTheDocument();
  });

  it("shows the sticky bar when content overflows horizontally", () => {
    renderTable(<tbody><tr><td>wide</td></tr></tbody>);
    const viewport = screen.getByTestId("sticky-scroll-viewport");
    forceOverflow(viewport);

    const bar = screen.getByTestId("sticky-scroll-bar");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-hidden", "true");
    // The spacer mirrors the table scrollWidth so the strip scrolls 1:1.
    expect(bar.firstElementChild).toHaveStyle({ width: "1000px" });
  });

  it("hides the sticky bar again when overflow disappears", () => {
    renderTable(<tbody><tr><td>wide</td></tr></tbody>);
    const viewport = screen.getByTestId("sticky-scroll-viewport");
    forceOverflow(viewport);
    expect(screen.getByTestId("sticky-scroll-bar")).toBeInTheDocument();

    Object.defineProperty(viewport, "scrollWidth", {
      configurable: true,
      value: 300,
    });
    act(() => {
      MockResizeObserver.instances.forEach((ro) => ro.emit());
    });

    expect(screen.queryByTestId("sticky-scroll-bar")).not.toBeInTheDocument();
  });

  it("syncs the sticky bar scrollLeft when the viewport scrolls", () => {
    renderTable(<tbody><tr><td>wide</td></tr></tbody>);
    const viewport = screen.getByTestId("sticky-scroll-viewport");
    forceOverflow(viewport);
    const bar = screen.getByTestId("sticky-scroll-bar");

    Object.defineProperty(viewport, "scrollLeft", {
      configurable: true,
      value: 240,
      writable: true,
    });
    Object.defineProperty(bar, "scrollLeft", {
      configurable: true,
      value: 0,
      writable: true,
    });

    fireEvent.scroll(viewport);
    expect(bar.scrollLeft).toBe(240);
  });

  it("syncs the viewport scrollLeft when the sticky bar is dragged", () => {
    renderTable(<tbody><tr><td>wide</td></tr></tbody>);
    const viewport = screen.getByTestId("sticky-scroll-viewport");
    forceOverflow(viewport);
    const bar = screen.getByTestId("sticky-scroll-bar");

    Object.defineProperty(viewport, "scrollLeft", {
      configurable: true,
      value: 0,
      writable: true,
    });
    Object.defineProperty(bar, "scrollLeft", {
      configurable: true,
      value: 480,
      writable: true,
    });

    fireEvent.scroll(bar);
    expect(viewport.scrollLeft).toBe(480);
  });

  it("does not bounce scroll positions between the two elements", () => {
    renderTable(<tbody><tr><td>wide</td></tr></tbody>);
    const viewport = screen.getByTestId("sticky-scroll-viewport");
    forceOverflow(viewport);
    const bar = screen.getByTestId("sticky-scroll-bar");

    Object.defineProperty(viewport, "scrollLeft", {
      configurable: true,
      value: 120,
      writable: true,
    });
    Object.defineProperty(bar, "scrollLeft", {
      configurable: true,
      value: 120,
      writable: true,
    });

    // Scrolling one element updates the other, but the guard prevents a
    // feedback loop from ever moving them out of sync.
    fireEvent.scroll(viewport);
    expect(bar.scrollLeft).toBe(120);
    fireEvent.scroll(bar);
    expect(viewport.scrollLeft).toBe(120);
  });

  it("applies rounded corners when a radius is provided", () => {
    render(
      <StickyScrollX radius={8}>
        <table />
      </StickyScrollX>,
    );
    const viewport = screen.getByTestId("sticky-scroll-viewport");
    expect(viewport).toHaveStyle({ borderRadius: "8px" });
  });
});
