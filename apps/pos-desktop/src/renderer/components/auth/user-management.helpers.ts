/**
 * Helpers for the user management page.
 *
 * @category Utilities
 */

import type { TFunction } from "i18next";

// ---------------------------------------------------------------------------
// Role → i18n key mapping
// ---------------------------------------------------------------------------

const ROLE_I18N_MAP: Record<string, string> = {
  CASHIER: "roles.cashier",
  MANAGER: "roles.manager",
  OWNER: "roles.owner",
  ACCOUNTANT: "roles.accountant",
  INVENTORY_ASSISTANT: "roles.inventory_assistant",
  SAAS_ADMIN: "roles.saas_admin",
  ADMIN: "roles.admin",
};

export function translateRole(role: string, t: TFunction): string {
  const key = ROLE_I18N_MAP[role];
  return key ? t(key) : role;
}

// ---------------------------------------------------------------------------
// Role badge color — Tailwind v4 semantic classes per role
// ---------------------------------------------------------------------------

const ROLE_BADGE_CLASSES: Record<string, string> = {
  CASHIER: "bg-pharma/10 text-pharma",
  MANAGER: "bg-urgency/10 text-urgency",
  OWNER: "bg-restrict/10 text-restrict",
  ACCOUNTANT: "bg-sync/10 text-sync",
  INVENTORY_ASSISTANT: "bg-pharma/10 text-pharma",
  SAAS_ADMIN: "bg-restrict/10 text-restrict",
  ADMIN: "bg-restrict/10 text-restrict",
};

export function roleBadgeClass(role: string): string {
  return ROLE_BADGE_CLASSES[role] ?? "bg-[color-mix(in_srgb,var(--color-ink)_8%,transparent)] text-ink/60";
}

// ---------------------------------------------------------------------------
// Status pill — Tailwind v4 semantic classes
// ---------------------------------------------------------------------------

const STATUS_CLASSES: Record<string, string> = {
  ACTIVE: "bg-success-container text-success",
  DISABLED: "bg-ink/8 text-ink-muted",
  LOCKED: "bg-error-container text-error",
  DELETED: "bg-error-container/40 text-error line-through",
};

export function statusClass(status: string): string {
  return STATUS_CLASSES[status] ?? "bg-ink/8 text-ink-muted";
}

// ---------------------------------------------------------------------------
// Last-login formatting
// ---------------------------------------------------------------------------

/**
 * Check if a user has been soft-deleted (deletedAt is set).
 */
export function isDeletedUser(
  deletedAt: string | null | undefined,
): boolean {
  return deletedAt != null;
}

export function formatLastLogin(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}
