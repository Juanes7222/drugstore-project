/**
 * Unit tests for useZoneNavigation.
 *
 * Zone fixtures are real elements with `data-nav-zone` attributes appended
 * to the document body; `offsetParent` is stubbed (jsdom always returns
 * null) so the visibility filter treats them as rendered. Keydown events
 * are dispatched on window or on target elements to exercise the capture
 * phase handler and its yield rules.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  NAV_ZONE_ATTR,
  ZONE_ACTIVATE_EVENT,
  useZoneNavigation,
} from "./use-zone-navigation";

// ---------------------------------------------------------------------------
// Zone fixtures
// ---------------------------------------------------------------------------

const makeZone = (id: string, offsetParent: unknown = {}): HTMLElement => {
  const el = document.createElement("section");
  el.setAttribute(NAV_ZONE_ATTR, id);
  Object.defineProperty(el, "offsetParent", {
    value: offsetParent,
    configurable: true,
  });
  document.body.appendChild(el);
  return el;
};

const clearZones = (): void => {
  document
    .querySelectorAll(`[${NAV_ZONE_ATTR}]`)
    .forEach((el) => el.remove());
};

const pressKey = (init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => window.dispatchEvent(event));
  return event;
};

/** Dispatch a keydown that bubbles up from the given element. */
const pressKeyOn = (
  target: HTMLElement,
  init: KeyboardEventInit,
): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => target.dispatchEvent(event));
  return event;
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useZoneNavigation", () => {
  beforeEach(() => {
    clearZones();
  });

  afterEach(() => {
    clearZones();
  });

  describe("traversal (ArrowLeft/ArrowRight)", () => {
    it("ArrowRight highlights the first zone from a cold start", () => {
      makeZone("a");
      makeZone("b");
      const { result } = renderHook(() =>
        useZoneNavigation({ activeScreen: "sales" }),
      );

      pressKey({ key: "ArrowRight" });

      expect(result.current.activeZoneId).toBe("a");
    });

    it("ArrowLeft highlights the last zone from a cold start", () => {
      makeZone("a");
      makeZone("b");
      const { result } = renderHook(() =>
        useZoneNavigation({ activeScreen: "sales" }),
      );

      pressKey({ key: "ArrowLeft" });

      expect(result.current.activeZoneId).toBe("b");
    });

    it("ArrowRight walks forward and ArrowLeft walks back", () => {
      makeZone("a");
      makeZone("b");
      makeZone("c");
      const { result } = renderHook(() =>
        useZoneNavigation({ activeScreen: "sales" }),
      );

      pressKey({ key: "ArrowRight" });
      pressKey({ key: "ArrowRight" });
      expect(result.current.activeZoneId).toBe("b");

      pressKey({ key: "ArrowLeft" });
      expect(result.current.activeZoneId).toBe("a");
    });

    it("wraps around at both ends of the loop", () => {
      makeZone("a");
      makeZone("b");
      const { result } = renderHook(() =>
        useZoneNavigation({ activeScreen: "sales" }),
      );

      pressKey({ key: "ArrowLeft" });
      expect(result.current.activeZoneId).toBe("b");

      pressKey({ key: "ArrowLeft" });
      expect(result.current.activeZoneId).toBe("a");

      pressKey({ key: "ArrowRight" });
      pressKey({ key: "ArrowRight" });
      expect(result.current.activeZoneId).toBe("a");
    });

    it("skips zones hidden by layout (offsetParent null)", () => {
      makeZone("hidden", null);
      makeZone("visible");
      const { result } = renderHook(() =>
        useZoneNavigation({ activeScreen: "sales" }),
      );

      pressKey({ key: "ArrowRight" });

      expect(result.current.activeZoneId).toBe("visible");
    });

    it("skips zones flagged data-nav-disabled", () => {
      const disabled = makeZone("disabled");
      disabled.setAttribute("data-nav-disabled", "");
      makeZone("enabled");
      const { result } = renderHook(() =>
        useZoneNavigation({ activeScreen: "sales" }),
      );

      pressKey({ key: "ArrowRight" });

      expect(result.current.activeZoneId).toBe("enabled");
    });

    it("marks the active zone with data-zone-active and clears the rest", () => {
      makeZone("a");
      makeZone("b");
      renderHook(() => useZoneNavigation({ activeScreen: "sales" }));

      pressKey({ key: "ArrowRight" });
      pressKey({ key: "ArrowRight" });

      const a = document.querySelector(`[${NAV_ZONE_ATTR}="a"]`)!;
      const b = document.querySelector(`[${NAV_ZONE_ATTR}="b"]`)!;
      expect(a.hasAttribute("data-zone-active")).toBe(false);
      expect(b.hasAttribute("data-zone-active")).toBe(true);
    });
  });

  describe("activation (Enter/Space)", () => {
    it("Enter dispatches zone-activate on the highlighted zone", () => {
      const zone = makeZone("a");
      const onActivate = vi.fn();
      zone.addEventListener(ZONE_ACTIVATE_EVENT, onActivate);
      const { result } = renderHook(() =>
        useZoneNavigation({ activeScreen: "sales" }),
      );

      pressKey({ key: "ArrowRight" });
      pressKey({ key: "Enter" });

      expect(onActivate).toHaveBeenCalledOnce();
      expect(result.current.activeZoneId).toBe("a");
    });

    it("Space also activates the highlighted zone", () => {
      const zone = makeZone("a");
      const onActivate = vi.fn();
      zone.addEventListener(ZONE_ACTIVATE_EVENT, onActivate);
      renderHook(() => useZoneNavigation({ activeScreen: "sales" }));

      pressKey({ key: "ArrowRight" });
      pressKey({ key: " " });

      expect(onActivate).toHaveBeenCalledOnce();
    });

    it("Enter is untouched when no zone is highlighted", () => {
      makeZone("a");
      renderHook(() => useZoneNavigation({ activeScreen: "sales" }));

      const event = pressKey({ key: "Enter" });

      expect(event.defaultPrevented).toBe(false);
    });


    it("Enter on a focused button keeps its native behavior (no double-fire)", () => {
      const zone = makeZone("a");
      const onActivate = vi.fn();
      zone.addEventListener(ZONE_ACTIVATE_EVENT, onActivate);
      const button = document.createElement("button");
      zone.appendChild(button);
      renderHook(() => useZoneNavigation({ activeScreen: "sales" }));

      pressKey({ key: "ArrowRight" });
      const event = pressKeyOn(button, { key: "Enter" });

      // A button target inside the zone owns Enter natively.
      expect(event.defaultPrevented).toBe(false);
      expect(onActivate).not.toHaveBeenCalled();
    });
  });

  describe("Escape", () => {
    it("clears the highlight and removes the ring", () => {
      const zone = makeZone("a");
      const { result } = renderHook(() =>
        useZoneNavigation({ activeScreen: "sales" }),
      );

      pressKey({ key: "ArrowRight" });
      expect(zone.hasAttribute("data-zone-active")).toBe(true);

      pressKey({ key: "Escape" });

      expect(result.current.activeZoneId).toBeNull();
      expect(zone.hasAttribute("data-zone-active")).toBe(false);
    });

    it("is untouched when no zone is highlighted", () => {
      renderHook(() => useZoneNavigation({ activeScreen: "sales" }));

      const event = pressKey({ key: "Escape" });

      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe("yield rules", () => {
    it("does not intercept arrows while focus is inside a form control", () => {
      makeZone("a");
      renderHook(() => useZoneNavigation({ activeScreen: "sales" }));
      const input = document.createElement("input");
      document.body.appendChild(input);

      const event = pressKeyOn(input, { key: "ArrowLeft" });

      expect(event.defaultPrevented).toBe(false);
      input.remove();
    });

    it("does not intercept Enter/Escape while focus is inside a form control", () => {
      makeZone("a");
      renderHook(() => useZoneNavigation({ activeScreen: "sales" }));
      pressKey({ key: "ArrowRight" });
      const input = document.createElement("input");
      document.body.appendChild(input);

      const enterEvent = pressKeyOn(input, { key: "Enter" });
      const escapeEvent = pressKeyOn(input, { key: "Escape" });

      expect(enterEvent.defaultPrevented).toBe(false);
      expect(escapeEvent.defaultPrevented).toBe(false);
      input.remove();
    });

    it("does not intercept keys inside data-search-results", () => {
      makeZone("a");
      const { result } = renderHook(() =>
        useZoneNavigation({ activeScreen: "sales" }),
      );
      const results = document.createElement("div");
      results.setAttribute("data-search-results", "");
      const listbox = document.createElement("div");
      results.appendChild(listbox);
      document.body.appendChild(results);

      pressKeyOn(listbox, { key: "ArrowRight" });

      expect(result.current.activeZoneId).toBeNull();
      results.remove();
    });

    it("does nothing while an editor is open", () => {
      makeZone("a");
      const { result } = renderHook(() =>
        useZoneNavigation({ activeScreen: "sales", isEditorOpen: true }),
      );

      pressKey({ key: "ArrowRight" });
      pressKey({ key: "Escape" });

      expect(result.current.activeZoneId).toBeNull();
    });

    it("does nothing when disabled (activeScreen null)", () => {
      makeZone("a");
      const { result } = renderHook(() =>
        useZoneNavigation({ activeScreen: null }),
      );

      const event = pressKey({ key: "ArrowRight" });

      expect(result.current.activeZoneId).toBeNull();
      expect(event.defaultPrevented).toBe(false);
    });

    it("does nothing when the event was already prevented", () => {
      makeZone("a");
      renderHook(() => useZoneNavigation({ activeScreen: "sales" }));
      const event = new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault();

      act(() => window.dispatchEvent(event));

      expect(document.querySelector("[data-zone-active]")).toBeNull();
    });

    it("does nothing while an IME composition is in progress", () => {
      makeZone("a");
      const { result } = renderHook(() =>
        useZoneNavigation({ activeScreen: "sales" }),
      );

      pressKey({ key: "ArrowRight", isComposing: true });

      expect(result.current.activeZoneId).toBeNull();
    });
  });

  describe("programmatic helpers", () => {
    it("focusZone highlights a zone by id", () => {
      makeZone("a");
      makeZone("b");
      const { result } = renderHook(() =>
        useZoneNavigation({ activeScreen: "sales" }),
      );

      act(() => result.current.focusZone("b"));

      expect(result.current.activeZoneId).toBe("b");
    });

    it("moveZone moves from the programmatic anchor", () => {
      makeZone("a");
      makeZone("b");
      const { result } = renderHook(() =>
        useZoneNavigation({ activeScreen: "sales" }),
      );

      act(() => result.current.focusZone("a"));
      act(() => result.current.moveZone(1));

      expect(result.current.activeZoneId).toBe("b");
    });

    it("clearZone removes the highlight", () => {
      makeZone("a");
      const { result } = renderHook(() =>
        useZoneNavigation({ activeScreen: "sales" }),
      );

      act(() => result.current.focusZone("a"));
      act(() => result.current.clearZone());

      expect(result.current.activeZoneId).toBeNull();
    });
  });
});
