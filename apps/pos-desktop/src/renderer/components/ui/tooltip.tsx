/**
 * Lightweight tooltip component with fade-in animation.
 *
 * Wraps a child element and shows a positioned tooltip on hover / keyboard
 * focus.  Uses the `motion` library for the enter/exit transition.
 *
 * @category UI
 */

import { type FC, type ReactNode, useRef, useState, useId, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TooltipProps {
  /** The trigger element (button, span, div, etc.). */
  children: ReactNode;
  /** Text content shown inside the tooltip. */
  label: string;
  /** Position relative to the trigger. */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Delay before showing (ms). Default 400. */
  delay?: number;
  /** Additional class names for the tooltip panel. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Tooltip: FC<TooltipProps> = ({
  children,
  label,
  position = 'top',
  delay = 400,
  className = '',
}) => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const tooltipId = `tooltip-${id}`;

  const show = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  // Position classes
  const positionClasses: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  // Arrow position (opposite to the tooltip position)
  const arrowClasses: Record<string, string> = {
    top: 'top-full left-1/2 -translate-x-1/2 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-800',
    left: 'left-full top-1/2 -translate-y-1/2 border-t-4 border-b-4 border-l-4 border-transparent border-l-gray-800',
    right: 'right-full top-1/2 -translate-y-1/2 border-t-4 border-b-4 border-r-4 border-transparent border-r-gray-800',
  };

  // Clear the show timer on unmount to avoid state updates on a dead component.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!label) {
    return <>{children}</>;
  }

  return (
    <span
      className="relative inline-flex"
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={visible ? tooltipId : undefined}
    >
      {children}

      <AnimatePresence>
        {visible && (
          <motion.span
            id={tooltipId}
            role="tooltip"
            initial={{ opacity: 0, y: position === 'top' ? 4 : position === 'bottom' ? -4 : 0 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: position === 'top' ? 4 : position === 'bottom' ? -4 : 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-gray-800 px-2.5 py-1.5 text-xs leading-tight text-white shadow-lg ${positionClasses[position]} ${className}`}
          >
            {label}
            <span
              className={`absolute ${arrowClasses[position]}`}
              aria-hidden="true"
            />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
};
