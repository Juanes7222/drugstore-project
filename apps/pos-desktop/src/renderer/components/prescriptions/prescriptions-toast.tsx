/**
 * PrescriptionsToast — fixed-position toast wrapper that delegates to
 * OperationQueuedToast for prescription registration confirmations.
 *
 * Placed at the bottom-right corner of the viewport so it does not
 * interfere with the form layout.
 */
import { type FC } from "react";
import { OperationQueuedToast } from "@/components/common/operation-queued-toast";

interface PrescriptionsToastProps {
  operationUuid: string;
  operationType: string;
  isVerified: boolean;
  isOnline: boolean;
  onDismiss: () => void;
}

export const PrescriptionsToast: FC<PrescriptionsToastProps> = ({
  operationUuid,
  operationType,
  isVerified,
  isOnline,
  onDismiss,
}) => {
  return (
    <div
      className="fixed bottom-pos-xl right-pos-xl z-50"
      style={{ pointerEvents: "auto" }}
    >
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
