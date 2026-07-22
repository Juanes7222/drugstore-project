/**
 * Helper functions for license status display.
 *
 * @category Utilities
 */

import { LicenseStatus } from "@pharmacy/shared-types";
import type { TFunction } from "i18next";

// ---------------------------------------------------------------------------
// Date formatters
// ---------------------------------------------------------------------------

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("es-ES", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

// ---------------------------------------------------------------------------
// Status descriptor
// ---------------------------------------------------------------------------

export interface StatusDescriptor {
  label: string;
  bgClass: string;
  textClass: string;
  dotClass: string;
}

export function getStatusDescriptor(
  status: LicenseStatus,
  t: TFunction,
  tokenExpiresAt: string | null,
): StatusDescriptor {
  switch (status) {
    case LicenseStatus.ACTIVE:
      return {
        label: t("licensing.status_page.active_label", {
          date: formatDate(tokenExpiresAt),
        }),
        bgClass: "bg-pharma",
        textClass: "text-panel",
        dotClass: "bg-panel",
      };
    case LicenseStatus.GRACE_PERIOD:
      return {
        label: t("licensing.status_page.grace_period_label", {
          date: formatDate(tokenExpiresAt),
        }),
        bgClass: "bg-urgency",
        textClass: "text-panel",
        dotClass: "bg-panel",
      };
    case LicenseStatus.LOCKED:
      return {
        label: t("licensing.status_page.locked_label"),
        bgClass: "bg-red-700",
        textClass: "text-panel",
        dotClass: "bg-panel",
      };
    case LicenseStatus.REVOKED:
      return {
        label: t("licensing.status_page.revoked_label"),
        bgClass: "bg-red-700",
        textClass: "text-panel",
        dotClass: "bg-panel",
      };
    default:
      return {
        label: t("licensing.status_page.unknown_label"),
        bgClass: "bg-sync",
        textClass: "text-panel",
        dotClass: "bg-panel",
      };
  }
}

// ---------------------------------------------------------------------------
// Feature labels
// ---------------------------------------------------------------------------

export const FEATURE_LABELS: Record<string, string> = {
  MULTI_LOCATION: "licensing.status_page.feature_multi_location",
  ADVANCED_REPORTS: "licensing.status_page.feature_advanced_reports",
  MULTI_TERMINAL_SYNC: "licensing.status_page.feature_multi_terminal_sync",
  LABEL_PRINTING: "licensing.status_page.feature_label_printing",
  CUSTOMER_DISPLAY: "licensing.status_page.feature_customer_display",
  PRIORITY_SUPPORT: "licensing.status_page.feature_priority_support",
};
