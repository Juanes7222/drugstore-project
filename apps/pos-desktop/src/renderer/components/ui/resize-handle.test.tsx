/**
 * Tests for the ResizeHandle component.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResizeHandle } from "./resize-handle";
import type { ResizeHandleProps } from "../../hooks/use-resizable-width";

function makeHandleProps(
  overrides: Partial<ResizeHandleProps> = {},
): ResizeHandleProps {
  return {
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": "Resize panel",
    "aria-valuemin": 320,
    "aria-valuemax": 960,
    "aria-valuenow": 480,
    tabIndex: 0,
    title: "Resize panel",
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onKeyDown: vi.fn(),
    onDoubleClick: vi.fn(),
    ...overrides,
  };
}

describe("ResizeHandle", () => {
  it("renders with the accessible separator role", () => {
    render(<ResizeHandle handleProps={makeHandleProps()} isResizing={false} />);

    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("forwards the aria value metadata", () => {
    render(<ResizeHandle handleProps={makeHandleProps()} isResizing={false} />);

    const handle = screen.getByRole("separator");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-valuenow", "480");
    expect(handle).toHaveAttribute("aria-valuemin", "320");
    expect(handle).toHaveAttribute("aria-valuemax", "960");
  });

  it("applies the positioning className", () => {
    const { container } = render(
      <ResizeHandle
        handleProps={makeHandleProps()}
        isResizing={false}
        className="absolute -left-1.5 top-0 bottom-0"
      />,
    );

    const handle = container.firstElementChild as HTMLElement;
    expect(handle.className).toContain("absolute");
    expect(handle.className).toContain("-left-1.5");
  });

  it("forwards pointer and keyboard events", () => {
    const props = makeHandleProps();
    render(<ResizeHandle handleProps={props} isResizing={false} />);

    const handle = screen.getByRole("separator");
    fireEvent.pointerDown(handle, { button: 0 });
    fireEvent.pointerMove(handle, { clientX: 100 });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.doubleClick(handle);

    expect(props.onPointerDown).toHaveBeenCalledTimes(1);
    expect(props.onPointerMove).toHaveBeenCalledTimes(1);
    expect(props.onKeyDown).toHaveBeenCalledTimes(1);
    expect(props.onDoubleClick).toHaveBeenCalledTimes(1);
  });
});
