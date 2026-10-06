import type { CSSProperties, ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /** 0-based stagger slot; each step shifts the reveal 5% along the scroll. */
  index?: number;
  className?: string;
  id?: string;
}

/**
 * Scroll-reveal wrapper. The motion lives entirely in `.reveal` in global.css,
 * driven by a view() timeline on the element itself — this component only
 * carries the stagger index. Nothing here observes, so a reveal costs no
 * JavaScript and no state write during scroll.
 */
export function Reveal({ children, index = 0, className, id }: RevealProps) {
  return (
    <div
      id={id}
      className={`reveal ${className ?? ""}`}
      style={{ "--reveal-index": index } as CSSProperties}
    >
      {children}
    </div>
  );
}
