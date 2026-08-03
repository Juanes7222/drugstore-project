/**
 * useResizableWidth — resizable side-panel width with persistence.
 *
 * Returns the current panel width plus props to spread onto a resize handle.
 * The width is clamped to [minWidth, maxWidth], persisted in the user
 * preferences store (localStorage) under a per-panel key, and restored on
 * the next open.
 *
 * Interactions:
 * - Drag the handle (pointer capture) to resize live.
 * - ArrowLeft / ArrowRight nudge ±16px (±48px with Shift).
 * - Home / End jump to min / max.
 * - Double-click resets to the default width.
 * - Keyboard accessible via role="separator" + aria-valuenow.
 *
 * @category Hook
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useUserPreferencesStore } from "../../stores/user-preferences.store";

export interface UseResizableWidthOptions {
  /** Unique persistence key for this panel (e.g. "sync-entry-drawer"). */
  storageKey: string;
  /** Default width in px (used when no persisted value exists). */
  defaultWidth: number;
  /** Minimum width in px. */
  minWidth: number;
  /** Maximum width in px. */
  maxWidth: number;
  /** Accessible name for the resize handle. */
  label: string;
}

export interface ResizeHandleProps {
  role: "separator";
  "aria-orientation": "vertical";
  "aria-label": string;
  "aria-valuemin": number;
  "aria-valuemax": number;
  "aria-valuenow": number;
  tabIndex: number;
  title: string;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
}

export interface UseResizableWidthResult {
  /** Current width in px. */
  width: number;
  /** Whether the user is currently dragging the handle. */
  isResizing: boolean;
  /** Spread onto the handle element (a div with role="separator"). */
  handleProps: ResizeHandleProps;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const KEYBOARD_STEP = 16;
const KEYBOARD_STEP_FAST = 48;

export function useResizableWidth({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  label,
}: UseResizableWidthOptions): UseResizableWidthResult {
  const persistedWidth = useUserPreferencesStore(
    (state) => state.panelWidths[storageKey],
  );
  const setPanelWidth = useUserPreferencesStore((state) => state.setPanelWidth);

  const [width, setWidth] = useState(() =>
    clamp(persistedWidth ?? defaultWidth, minWidth, maxWidth),
  );
  const [isResizing, setIsResizing] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;
  const dragStart = useRef<{ startX: number; startWidth: number } | null>(null);

  // Follow persisted changes (restore after hydration or external updates).
  useEffect(() => {
    setWidth(clamp(persistedWidth ?? defaultWidth, minWidth, maxWidth));
  }, [persistedWidth, defaultWidth, minWidth, maxWidth]);

  const commitWidth = useCallback(
    (next: number) => {
      const clamped = clamp(next, minWidth, maxWidth);
      setWidth(clamped);
      setPanelWidth(storageKey, clamped);
    },
    [minWidth, maxWidth, setPanelWidth, storageKey],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragStart.current = { startX: event.clientX, startWidth: widthRef.current };
      setIsResizing(true);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is unavailable in some test environments.
      }
    },
    [],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!dragStart.current) return;
      const delta = dragStart.current.startX - event.clientX;
      const next = dragStart.current.startWidth + delta;
      setWidth(clamp(next, minWidth, maxWidth));
    },
    [minWidth, maxWidth],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const start = dragStart.current;
      if (!start) return;
      dragStart.current = null;
      setIsResizing(false);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture is unavailable in some test environments.
      }
      // Compute from the recorded drag start so the committed width is
      // deterministic even if the last move did not trigger a re-render.
      const finalWidth = start.startWidth + (start.startX - event.clientX);
      commitWidth(finalWidth);
    },
    [commitWidth],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? KEYBOARD_STEP_FAST : KEYBOARD_STEP;
      let next: number | null = null;
      switch (event.key) {
        case "ArrowLeft":
          next = widthRef.current - step;
          break;
        case "ArrowRight":
          next = widthRef.current + step;
          break;
        case "Home":
          next = minWidth;
          break;
        case "End":
          next = maxWidth;
          break;
        default:
          return;
      }
      event.preventDefault();
      commitWidth(next);
    },
    [commitWidth, minWidth, maxWidth],
  );

  const handleDoubleClick = useCallback(() => {
    commitWidth(defaultWidth);
  }, [commitWidth, defaultWidth]);

  return {
    width,
    isResizing,
    handleProps: {
      role: "separator",
      "aria-orientation": "vertical",
      "aria-label": label,
      "aria-valuemin": minWidth,
      "aria-valuemax": maxWidth,
      "aria-valuenow": width,
      tabIndex: 0,
      title: label,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onKeyDown: handleKeyDown,
      onDoubleClick: handleDoubleClick,
    },
  };
}
