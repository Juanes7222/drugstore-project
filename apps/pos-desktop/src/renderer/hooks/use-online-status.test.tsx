/**
 * Tests for useOnlineStatus hook.
 *
 * We render a test component that displays the boolean value, then
 * dispatch window online/offline events to verify the hook reacts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useOnlineStatus } from "./use-online-status";

function TestComponent() {
  const isOnline = useOnlineStatus();
  return <div data-testid="online-status">{isOnline ? "online" : "offline"}</div>;
}

describe("useOnlineStatus", () => {
  afterEach(() => {
    // Restore online state
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("returns the current navigator.onLine value initially", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });

    render(<TestComponent />);

    expect(screen.getByTestId("online-status")).toHaveTextContent("online");
  });

  it("returns offline when navigator.onLine is false", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });

    render(<TestComponent />);

    expect(screen.getByTestId("online-status")).toHaveTextContent("offline");
  });

  it("reacts to the window online event", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    render(<TestComponent />);

    expect(screen.getByTestId("online-status")).toHaveTextContent("offline");

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(screen.getByTestId("online-status")).toHaveTextContent("online");
  });

  it("reacts to the window offline event", () => {
    render(<TestComponent />);

    expect(screen.getByTestId("online-status")).toHaveTextContent("online");

    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.getByTestId("online-status")).toHaveTextContent("offline");
  });
});
