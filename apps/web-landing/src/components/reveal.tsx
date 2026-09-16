import type { CSSProperties, ReactNode } from "react";
import { useReveal } from "../hooks/use-reveal";

interface RevealProps {
  children: ReactNode;
  /** 0-based stagger slot; each step adds 70 ms of delay. */
  index?: number;
  className?: string;
  id?: string;
}

/**
 * Scroll-triggered fade-up wrapper (see .reveal in global.css). Reveals once
 * on first view; with reduced motion it collapses to a short fade.
 */
export function Reveal({ children, index = 0, className, id }: RevealProps) {
  const ref = useReveal<HTMLDivElement>();

  return (
    <div
      ref={ref}
      id={id}
      data-visible="false"
      className={`reveal ${className ?? ""}`}
      style={{ "--reveal-index": index } as CSSProperties}
    >
      {children}
    </div>
  );
}
