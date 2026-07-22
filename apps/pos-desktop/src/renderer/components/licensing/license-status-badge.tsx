/**
 * License status badge — colored pill showing the current license status.
 *
 * @category Component
 */

import { type FC } from "react";
import type { StatusDescriptor } from "./license-status.helpers";

export interface LicenseStatusBadgeProps {
  descriptor: StatusDescriptor;
}

export const LicenseStatusBadge: FC<LicenseStatusBadgeProps> = ({
  descriptor,
}) => (
  <div
    className={`mb-pos-lg inline-flex items-center gap-pos-sm rounded-pos px-pos-md py-pos-sm ${descriptor.bgClass} ${descriptor.textClass}`}
    role="status"
  >
    <span
      className={`inline-block h-2 w-2 rounded-full ${descriptor.dotClass}`}
      aria-hidden="true"
    />
    <span className="text-body-sm font-semibold">{descriptor.label}</span>
  </div>
);
