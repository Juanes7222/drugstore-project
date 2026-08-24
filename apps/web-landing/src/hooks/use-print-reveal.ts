import { useEffect, useRef } from 'react';

/**
 * Marks an element with data-printed="true" the first time it enters the
 * viewport, driving the receipt "printing" reveal in global.css. Returns a
 * ref to attach to the element. Elements already on screen at mount print on
 * the next frame; below-fold elements wait for an IntersectionObserver.
 */
export function usePrintReveal<T extends HTMLElement>() {
  const elementRef = useRef<T | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const markPrinted = () => element.setAttribute('data-printed', 'true');

    const rect = element.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      // Already visible: defer one frame so the transition actually plays.
      const frame = requestAnimationFrame(markPrinted);
      return () => cancelAnimationFrame(frame);
    }

    if (typeof IntersectionObserver === 'undefined') {
      markPrinted();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-printed', 'true');
            observer.unobserve(entry.target);
          }
        }
      },
      // Start slightly before fully visible so the print animation begins
      // as the document scrolls into view, not after it already landed.
      { rootMargin: '0px 0px -15% 0px', threshold: 0.1 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return elementRef;
}
