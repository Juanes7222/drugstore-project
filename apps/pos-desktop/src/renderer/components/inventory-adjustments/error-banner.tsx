/**
 * ErrorBanner — red alert banner with role="alert" for inline form errors.
 */
import { type FC } from "react";

interface ErrorBannerProps {
  message: string;
}

export const ErrorBanner: FC<ErrorBannerProps> = ({ message }) => (
  <div
    role="alert"
    className="mt-pos-md rounded-pos px-pos-md py-pos-sm text-body-sm font-medium"
    style={{
      backgroundColor: "color-mix(in srgb, #D32F2F 10%, transparent)",
      color: "#D32F2F",
      border: "1px solid color-mix(in srgb, #D32F2F 20%, transparent)",
    }}
  >
    {message}
  </div>
);
