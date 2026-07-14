/**
 * Tests for typed Redux hooks.
 *
 * Verifies that useAppDispatch and useAppSelector are wired correctly
 * by exercising them through a test component.
 */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "./store";
import { useAppDispatch, useAppSelector } from "./hooks";

import type { ReactNode } from "react";

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

describe("useAppDispatch", () => {
  it("returns the store dispatch function", () => {
    const { result } = renderHook(() => useAppDispatch(), { wrapper });
    expect(typeof result.current).toBe("function");
  });

  it("dispatches an action and updates state", () => {
    const { result } = renderHook(() => useAppDispatch(), { wrapper });
    result.current({ type: "ui/setActiveScreen", payload: "returns" });

    const state = store.getState();
    expect(state.ui.activeScreen).toBe("returns");

    // Reset
    store.dispatch({ type: "ui/setActiveScreen", payload: "sales" });
  });
});

describe("useAppSelector", () => {
  it("selects a value from the store state", () => {
    const { result } = renderHook(
      () => useAppSelector((state) => state.ui.activeScreen),
      { wrapper },
    );
    expect(result.current).toBe("sales");
  });

  it("re-renders with the new value when state changes", () => {
    const { result, rerender } = renderHook(
      () => useAppSelector((state) => state.ui.activeScreen),
      { wrapper },
    );

    store.dispatch({ type: "ui/setActiveScreen", payload: "receipt" });
    rerender();

    expect(result.current).toBe("receipt");

    // Reset
    store.dispatch({ type: "ui/setActiveScreen", payload: "sales" });
  });
});
