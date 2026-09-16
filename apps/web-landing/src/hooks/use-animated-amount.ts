import { useEffect, useRef, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Tweens a cents amount so billing-period switches read as motion instead of
 * a jump. Values stay integers (cents) so the formatter never shows fraction
 * artifacts. With prefers-reduced-motion the target is adopted instantly.
 */
export function useAnimatedAmount(
  targetCents: number,
  durationMs = 420,
): number {
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches;
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
