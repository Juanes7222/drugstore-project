/**
 * Colored alert banner for transient Sync Health notifications.
 *
 * Renders a dismissible-looking bar for success (green), error (red), or
 * info (blue) messages.  The parent container controls visibility and
 * auto-dismiss timing; this component only renders the visual bar.
 *
 * @category Component
 */

import { type FC } from "react";
import { CheckCircleIcon, InfoIcon, XCircleIcon } from "@/components/ui/icons";

interface SyncHealthToastProps {
  type: "success" | "error" | "info";
  message: string;
}

const STYLE_MAP: Record<
  SyncHealthToastProps["type"],
  { container: string; icon: string }
> = {
  success: {
    container: "border-green-200 bg-green-50 text-green-800",
    icon: "text-green-500",
  },
  error: {
    container: "border-red-200 bg-red-50 text-red-800",
    icon: "text-red-500",
  },
  info: {
    container: "border-blue-200 bg-blue-50 text-blue-800",
    icon: "text-blue-500",
  },
};

export const SyncHealthToast: FC<SyncHealthToastProps> = ({ type, message }) => {
  const style = STYLE_MAP[type];

  return (
    <div
      role="alert"
      className={`mb-4 flex items-center gap-2 rounded-md border px-4 py-3 text-sm font-medium ${style.container}`}
    >
      {type === "success" && <CheckCircleIcon className={`h-4 w-4 flex-shrink-0 ${style.icon}`} />}
      {type === "error" && <XCircleIcon className={`h-4 w-4 flex-shrink-0 ${style.icon}`} />}
      {type === "info" && <InfoIcon className={`h-4 w-4 flex-shrink-0 ${style.icon}`} />}
      <span>{message}</span>
    </div>
  );
};
