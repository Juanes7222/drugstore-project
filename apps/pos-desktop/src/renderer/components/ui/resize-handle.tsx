/**
 * ResizeHandle — visual drag handle for resizable side panels.
 *
 * Renders the handle props produced by useResizableWidth. The handle is a
 * full-height strip positioned at the panel's inner edge (caller places it
 * with `absolute` positioning inside a relative/fixed panel). A centered
 * grip line becomes visible on hover, focus, and while dragging.
 *
 * @category Component
 */

import { type FC } from "react";
import type { ResizeHandleProps } from "../../hooks/use-resizable-width";

interface ResizeHandleViewProps {
  /** Props from useResizableWidth().handleProps. */
  handleProps: ResizeHandleProps;
  /** Whether the user is currently dragging. */
  isResizing: boolean;
  /** Extra classes for positioning (e.g. "-left-2 top-0 bottom-0"). */
  className?: string;
}

export const ResizeHandle: FC<ResizeHandleViewProps> = ({
  handleProps,
  isResizing,
  className = "",
}) => {
  return (
    <div
      {...handleProps}
      className={`group flex w-2.5 cursor-col-resize touch-none select-none items-center justify-center outline-none focus-visible:outline-2 focus-visible:outline-pharma ${className}`}
    >
      <span
        aria-hidden="true"
        className={`h-12 w-1 rounded-full transition-colors duration-150 ${
          isResizing
            ? "bg-pharma"
            : "bg-ink/25 group-hover:bg-pharma/60 group-focus-visible:bg-pharma"
        }`}
      />
    </div>
  );
};
