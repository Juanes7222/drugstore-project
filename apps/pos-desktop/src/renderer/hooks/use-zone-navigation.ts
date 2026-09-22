/**
 * Zone navigation — arrow-key traversal between screen sections.
 *
 * Elements marked with `data-nav-zone="<id>"` become stops of a shared
 * navigation loop. The design is a two-level hierarchy that never fights
 * the specialized flows already in place:
 *
 * - **ArrowLeft / ArrowRight** move the zone highlight between sections
 *   (search panel ↔ cart ↔ delivery; print ↔ new sale on the receipt).
 *   Nothing else uses those keys on body focus, so there is no conflict.
 * - **Enter / Space** activate the highlighted zone by dispatching a
 *   `zone-activate` CustomEvent on it — the component owning the zone
 *   decides what "opening" means (focus its input, press its primary
 *   button, run its action…).
 * - **Escape** clears the highlight, handing arrows back to the inner
 *   flows (cart line selection, search results, payment rows).
 * - **ArrowUp / ArrowDown are never intercepted** — they belong to the
 *   inner flows (cart lines, search results, payment rows).
 *
 * The listener runs in the capture phase on `window`. Events originating
 * inside an area that owns its own keys (search results, payment rows) or
 * inside form controls are ignored. Only zones currently rendered
 * (`offsetParent !== null`, plus a `data-nav-disabled` opt-out) participate.
 */

import { useCallback, useEffect, useState } from "react";

/** DOM marker attribute for a navigation zone. */
export const NAV_ZONE_ATTR = "data-nav-zone";

/** Event dispatched on a zone when Enter/Space activates it. */
export const ZONE_ACTIVATE_EVENT = "zone-activate";

/** Marks a zone as temporarily skipped (e.g. disabled action). */
export const NAV_ZONE_DISABLED_ATTR = "data-nav-disabled";

/**
 * Query all visible zone elements in DOM order. Zones hidden by layout
 * (display:none subtrees) or flagged disabled are excluded.
 */
const getVisibleZones = (): HTMLElement[] =>
  Array.from(
    document.querySelectorAll<HTMLElement>(`[${NAV_ZONE_ATTR}]`),
  ).filter((el) => {
    if (el.hasAttribute(NAV_ZONE_DISABLED_ATTR)) return false;
    // offsetParent is null for display:none subtrees, which is exactly the
    // "not rendered" signal we need. (jsdom always returns null; tests
    // stub the property on their fixtures.)
    return el.offsetParent !== null;
  });

/** Is the key event originating inside an area that owns its own keys? */
const isInsideOwningArea = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  // Search results listbox: roving-tabindex keys handled internally.
  if (target.closest("[data-search-results]")) return true;
  // Payment rows: the payment keyboard owns their keys.
  if (target.closest("[data-payment-rows]")) return true;
  return false;
};

const isInteractiveTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    tagName === "button" ||
    target.isContentEditable
  );
};

export interface UseZoneNavigationDeps {
  /** Only listen while this screen is active; null disables the hook. */
  activeScreen: string | null;
  /** True while a modal/inline editor owns the keyboard (dialog, quick edit). */
  isEditorOpen?: boolean;
}

export interface UseZoneNavigationReturn {
  /** Id of the zone currently highlighted, or null when none. */
  activeZoneId: string | null;
  /** Move the highlight to the next (1) or previous (-1) visible zone. */
  moveZone: (delta: 1 | -1) => void;
  /** Highlight a zone by id without moving relatively. */
  focusZone: (zoneId: string) => void;
  /** Clear the highlight (Escape). */
  clearZone: () => void;
}

export function useZoneNavigation({
  activeScreen,
  isEditorOpen = false,
}: UseZoneNavigationDeps): UseZoneNavigationReturn {
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);

  const focusZone = useCallback((zoneId: string) => {
    if (!zoneId) return;
    setActiveZoneId(zoneId);
    document
      .querySelector<HTMLElement>(`[${NAV_ZONE_ATTR}="${zoneId}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, []);

  const moveZone = useCallback(
    (delta: 1 | -1) => {
      const zones = getVisibleZones();
      if (zones.length === 0) return;

      const currentIndex = zones.findIndex(
        (el) => el.dataset.navZone === activeZoneId,
      );

      let nextIndex: number;
      if (currentIndex === -1) {
        // No active zone yet: enter the loop at its natural edge for the
        // direction of travel (right → first zone, left → last zone).
        nextIndex = delta === 1 ? 0 : zones.length - 1;
      } else {
        nextIndex = (currentIndex + delta + zones.length) % zones.length;
      }

      focusZone(zones[nextIndex]?.dataset.navZone ?? "");
    },
    [activeZoneId, focusZone],
  );

  const clearZone = useCallback(() => setActiveZoneId(null), []);

  // ---- Highlight management -------------------------------------------------
  // The ring is applied imperatively so zone components stay dumb and the
  // hook never needs to re-render the whole tree on each move.
  useEffect(() => {
    const zones = document.querySelectorAll<HTMLElement>(`[${NAV_ZONE_ATTR}]`);
    zones.forEach((el) => {
      if (el.dataset.navZone === activeZoneId) {
        el.setAttribute("data-zone-active", "");
      } else {
        el.removeAttribute("data-zone-active");
      }
    });
    return () => {
      zones.forEach((el) => el.removeAttribute("data-zone-active"));
    };
  }, [activeZoneId]);

  // ---- Global keydown (capture phase) --------------------------------------
  useEffect(() => {
    if (activeScreen === null) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;

      // Inline editors and modals own the keyboard — never compete.
      if (isEditorOpen) return;

      switch (event.key) {
        case "ArrowLeft":
        case "ArrowRight": {
          // Nothing else uses horizontal arrows on body focus, but keep
          // caret movement intact inside form controls.
          if (isInteractiveTarget(target)) return;
          if (isInsideOwningArea(target)) return;
          event.preventDefault();
          event.stopPropagation();
          moveZone(event.key === "ArrowRight" ? 1 : -1);
          return;
        }
        case "Enter":
        case " ": {
          // Activate the highlighted zone — but only from a non-interactive
          // target: on buttons/inputs Enter and Space keep their native
          // behavior (click, caret).
          if (activeZoneId === null) return;
          if (isInteractiveTarget(target)) return;
          if (isInsideOwningArea(target)) return;
          const zone = document.querySelector<HTMLElement>(
            `[${NAV_ZONE_ATTR}="${activeZoneId}"]`,
          );
          if (!zone) return;
          event.preventDefault();
          event.stopPropagation();
          zone.dispatchEvent(
            new CustomEvent(ZONE_ACTIVATE_EVENT, { bubbles: false }),
          );
          return;
        }
        case "Escape": {
          // Only consume Escape when a highlight is active and the focus
          // is not in a control (inputs clear themselves first, search
          // results bounce focus back to the input, etc.).
          if (activeZoneId === null) return;
          if (isInteractiveTarget(target)) return;
          if (isInsideOwningArea(target)) return;
          event.preventDefault();
          event.stopPropagation();
          clearZone();
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activeScreen, isEditorOpen, activeZoneId, moveZone, clearZone]);

  return { activeZoneId, moveZone, focusZone, clearZone };
}
