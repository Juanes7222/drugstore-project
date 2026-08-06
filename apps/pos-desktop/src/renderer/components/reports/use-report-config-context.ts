/**
 * Report config-gating context hook.
 *
 * Reads the effective tenant purchases config and slices out the flags the
 * report catalog gates on (`requireLotOnReception`, `requireExpiryOnReception`).
 * Returns `null` until the config loads so gating is skipped — reports are
 * never hidden before the tenant config is known.
 *
 * Shared by the sidebar, the reports page, and the viewer so the gating
 * slice is defined in exactly one place.
 */
import { useMemo } from "react";
import { useTenantConfig } from "../../../domain/config/use-tenant-config";
import type { ReportConfigContext } from "../../../domain/reports/report-types";

export function useReportConfigContext(): ReportConfigContext | null {
  const { effectiveConfig } = useTenantConfig();
  return useMemo<ReportConfigContext | null>(
    () =>
      effectiveConfig
        ? {
            requireLotOnReception: effectiveConfig.purchases.requireLotOnReception,
            requireExpiryOnReception: effectiveConfig.purchases.requireExpiryOnReception,
          }
        : null,
    [effectiveConfig],
  );
}
