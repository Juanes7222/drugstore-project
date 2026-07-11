/**
 * ReturnsToast — fixed-position toast notification wrapping the shared
 * OperationQueuedToast component.
 *
 * Appears at the bottom-right corner after a successful return submission,
 * whether verified or unverified. Auto-dismisses via the wrapped component's
 * built-in timer.
 *
 * @category Component
 */

import { type FC } from "react";
import { OperationQueuedToast } from "@/components/common/operation-queued-toast";

interface ReturnsToastProps {
  /** UUID of the submitted operation (return). */
  operationUuid: string;
  /** Operation type label (e.g. "CLIENT_RETURN"). */
  operationType: string;
  /** Whether this was a verified return. */
  isVerified: boolean;
  /** Whether the terminal is currently online. */
  isOnline: boolean;
  /** Called when the toast auto-dismisses or is manually closed. */
  onDismiss: () => void;
}

export const ReturnsToast: FC<ReturnsToastProps> = ({
  operationUuid,
  operationType,
  isVerified,
  isOnline,
  onDismiss,
}) => {
  return (
    <div
      className="fixed bottom-pos-xl right-pos-xl z-50"
      style={{
        animation: "toast-enter 200ms ease-out",
      }}
    >
      <style>{`
        @keyframes toast-enter {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
      <OperationQueuedToast
        operationUuid={operationUuid}
        operationType={operationType}
        isVerified={isVerified}
        isOnline={isOnline}
        onDismiss={onDismiss}
      />
    </div>
  );
};
