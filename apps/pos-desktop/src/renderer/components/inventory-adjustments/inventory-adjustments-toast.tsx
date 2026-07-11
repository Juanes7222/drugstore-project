/**
 * InventoryAdjustmentsToast — fixed bottom-right toast wrapper that renders
 * the shared OperationQueuedToast for inventory adjustment confirmations.
 */
import { type FC } from "react";
import { OperationQueuedToast } from "@/components/common/operation-queued-toast";

interface InventoryAdjustmentsToastProps {
  operationUuid: string;
  operationType: string;
  isVerified: boolean;
  isOnline: boolean;
  onDismiss: () => void;
}

export const InventoryAdjustmentsToast: FC<InventoryAdjustmentsToastProps> = ({
  operationUuid,
  operationType,
  isVerified,
  isOnline,
  onDismiss,
}) => (
  <div
    className="fixed bottom-pos-xl right-pos-xl z-50"
    style={{ maxWidth: "400px" }}
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
