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
      <svg
        className={`h-4 w-4 flex-shrink-0 ${style.icon}`}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        {type === "success" && (
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
            clipRule="evenodd"
          />
        )}
        {type === "error" && (
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
            clipRule="evenodd"
          />
        )}
        {type === "info" && (
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
            clipRule="evenodd"
          />
        )}
      </svg>
      <span>{message}</span>
    </div>
  );
};
