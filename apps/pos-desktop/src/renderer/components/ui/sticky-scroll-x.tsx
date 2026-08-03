/**
 * StickyScrollX — keeps a table's horizontal scrollbar always visible at the
 * bottom of the screen while the table is on screen.
 *
 * Problem: a table wrapped in a plain `overflow-x-auto` div shows its native
 * horizontal scrollbar at the *bottom of the table*. When the table lives in
 * a page that scrolls vertically, the scrollbar sits below the fold — the
 * cashier has to scroll to the end of the table just to reach it.
 *
 * Approach: hide the native horizontal scrollbar on the real viewport and
 * render a slim, sticky strip (`position: sticky; bottom: 0`) right below
 * the table. The strip is itself horizontally scrollable and mirrors the
 * viewport's scroll position in both directions, so it behaves exactly like
 * the native scrollbar — but pinned to the bottom of the visible area while
 * the user scrolls through the table.
 *
 * The strip only renders when the content actually overflows horizontally
 * (measured with ResizeObserver), so narrow tables are unaffected.
 *
 * @category Component
 */

import {
  type CSSProperties,
  type FC,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

interface StickyScrollXProps {
  /** The table (or any wide content) to make horizontally scrollable. */
  children: ReactNode;
  /** Extra classes for the outer wrapper (borders, backgrounds). Must not clip overflow. */
  className?: string;
  /** Extra classes for the sticky strip (e.g. a matching card background). */
  barClassName?: string;
  /**
   * Corner radius in px applied to the scroll viewport and the sticky strip,
   * to match rounded cards (e.g. `rounded-pos` = 4). Defaults to 0.
   */
  radius?: number;
}

export const StickyScrollX: FC<StickyScrollXProps> = ({
  children,
  className = "",
  barClassName = "",
  radius = 0,
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  const [hasOverflow, setHasOverflow] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const scrollWidth = viewport.scrollWidth;
    const clientWidth = viewport.clientWidth;
    setHasOverflow(scrollWidth > clientWidth + 1);
    setTrackWidth(scrollWidth);
  }, []);

  useEffect(() => {
    measure();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    if (viewport.firstElementChild) {
      observer.observe(viewport.firstElementChild);
    }
    return () => observer.disconnect();
  }, [measure, children]);

  // When the sticky bar first appears, align it with any existing scroll
  // position so the thumb doesn't jump back to the start.
  useEffect(() => {
    if (hasOverflow && barRef.current && viewportRef.current) {
      barRef.current.scrollLeft = viewportRef.current.scrollLeft;
    }
  }, [hasOverflow]);

  const syncBarFromViewport = useCallback(() => {
    if (syncingRef.current || !barRef.current || !viewportRef.current) return;
    syncingRef.current = true;
    barRef.current.scrollLeft = viewportRef.current.scrollLeft;
    syncingRef.current = false;
  }, []);

  const syncViewportFromBar = useCallback(() => {
    if (syncingRef.current || !viewportRef.current || !barRef.current) return;
    syncingRef.current = true;
    viewportRef.current.scrollLeft = barRef.current.scrollLeft;
    syncingRef.current = false;
  }, []);

  // Round the viewport's top corners while the strip is visible; round all
  // corners when the strip is hidden so the card still looks finished.
  const viewportRadius: CSSProperties = radius
    ? hasOverflow
      ? { borderTopLeftRadius: radius, borderTopRightRadius: radius }
      : { borderRadius: radius }
    : {};

  const barRadius: CSSProperties = radius
    ? { borderBottomLeftRadius: radius, borderBottomRightRadius: radius }
    : {};

  return (
    <div className={className}>
      <div
        ref={viewportRef}
        onScroll={syncBarFromViewport}
        className="pos-sticky-scroll__viewport overflow-x-auto"
        style={viewportRadius}
        data-testid="sticky-scroll-viewport"
      >
        {children}
      </div>
      {hasOverflow && (
        <div
          ref={barRef}
          onScroll={syncViewportFromBar}
          aria-hidden="true"
          className={`pos-sticky-scroll__bar ${barClassName}`}
          style={barRadius}
          data-testid="sticky-scroll-bar"
        >
          {/* Spacer mirrors the table width so the strip scrolls 1:1 with it */}
          <div style={{ width: trackWidth, height: 1 }} />
        </div>
      )}
    </div>
  );
};
