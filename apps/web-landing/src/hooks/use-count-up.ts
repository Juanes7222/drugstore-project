import { useEffect, useRef, useState } from "react";
import { formatCOP } from "../lib/format";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Counts a peso amount up from zero the first time the returned element enters
 * the viewport, then holds. Returns the ref to attach, and whether it has
 * landed — which is the moment the shift panel is allowed to celebrate
 * balancing.
 *
 * A target that changes after that first count does not replay from zero and
 * does not snap either: it tweens from whatever is currently on screen to the
 * new figure, so a period switch reads as the number moving rather than as a
 * page that blinked.
 *
 * The tween writes `textContent` straight to the node instead of going through
 * React state. Three shift figures counting at once would otherwise re-render
 * the tree sixty times a second in the middle of a scroll, which is precisely
 * the main-thread work INP measures. React still renders the target as the
 * element's content, so the figure is correct with JavaScript disabled.
 */
export function useCountUp<T extends HTMLElement>(
  targetCents: number,
  durationMs = 900,
) {
  const elementRef = useRef<T | null>(null);
  const hasArrivedRef = useRef(false);
  const shownCentsRef = useRef(targetCents);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const adoptTarget = () => {
      element.textContent = formatCOP(targetCents);
      shownCentsRef.current = targetCents;
      setSettled(true);
    };

    if (
      window.matchMedia(REDUCED_MOTION_QUERY).matches ||
      typeof IntersectionObserver === "undefined"
    ) {
      adoptTarget();
      return;
    }

    let frame = 0;

    const tween = (fromCents: number) => {
      const start = performance.now();

      const tick = (now: number) => {
        const progress = Math.min((now - start) / durationMs, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = Math.round(fromCents + (targetCents - fromCents) * eased);
        shownCentsRef.current = value;
        element.textContent = formatCOP(value);
        if (progress < 1) {
          frame = requestAnimationFrame(tick);
          return;
        }
        hasArrivedRef.current = true;
        setSettled(true);
      };

      frame = requestAnimationFrame(tick);
    };

    // Already on screen and counted: a target change rolls from where it is.
    if (hasArrivedRef.current) {
      if (shownCentsRef.current !== targetCents) {
        tween(shownCentsRef.current);
      }
      return () => cancelAnimationFrame(frame);
    }

    // First arrival: count up from zero, once the figure is actually in view.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            tween(0);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.4 },
    );

    observer.observe(element);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [targetCents, durationMs]);

  return [elementRef, settled] as const;
}
