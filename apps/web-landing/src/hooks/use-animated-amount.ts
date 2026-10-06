import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Tracks the motion preference as a live value rather than a one-time read at
 * mount. Someone who turns reduced motion on while the page is open gets a page
 * that responds, instead of one still tweening against a setting they just
 * changed in their OS.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const query = window.matchMedia(REDUCED_MOTION_QUERY);
      query.addEventListener("change", onStoreChange);
      return () => query.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/**
 * Tweens a cents amount so billing-period switches read as motion instead of a
 * jump. Values stay integers (cents) so the formatter never shows fraction
 * artifacts. With reduced motion the target is adopted instantly.
 *
 * Unlike `useCountUp` this one goes through React state, because its callers
 * interpolate the amount into a translated sentence rather than owning the text
 * of a node. It runs for a fixed 420ms on an explicit click, never during
 * scroll, so the re-renders are bounded and off the critical path.
 */
export function useAnimatedAmount(
  targetCents: number,
  durationMs = 420,
): number {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [displayCents, setDisplayCents] = useState(targetCents);
  const fromRef = useRef(targetCents);

  useEffect(() => {
    if (prefersReducedMotion) {
      fromRef.current = targetCents;
      setDisplayCents(targetCents);
      return;
    }

    const from = fromRef.current;
    if (from === targetCents) return;

    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(from + (targetCents - from) * eased);
      fromRef.current = value;
      setDisplayCents(value);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [targetCents, durationMs, prefersReducedMotion]);

  return displayCents;
}
