import { useEffect, useRef } from "react";

const REVEAL_THRESHOLD = 0.15;

/**
 * Marks an element with data-visible="true" the first time it enters the
 * viewport, driving the .reveal fade-up in global.css. Reveals once and
 * never hides content again afterwards; elements already on screen at mount
 * are marked on the observer's first callback.
 */
export function useReveal<T extends HTMLElement>() {
  const elementRef = useRef<T | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const markVisible = () => element.setAttribute("data-visible", "true");

    if (typeof IntersectionObserver === "undefined") {
      markVisible();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-visible", "true");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: REVEAL_THRESHOLD, rootMargin: "0px 0px -10% 0px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return elementRef;
}
