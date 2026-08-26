/**
 * Hub — shared layout for module entry pages (Productos, Compras).
 *
 * Both hubs are the same pattern: a title + subtitle header, a
 * responsive card grid, and an optional footer strip. Unifying the
 * markup, spacing, and card treatment in one place guarantees the
 * two entry points never drift apart again.
 *
 * Card design comes from the purchases hub: bg-panel + shadow-pos-panel,
 * 48px pharma-tinted icon circle, arrow indicator bottom-right, optional
 * numeric badge top-right, hover lifts to shadow-pos-elevated. The
 * productos hub previously used inline --color-* styles, a bordered
 * card, and a 56px icon — all now aligned to this definition.
 *
 * @category UI — layout
 */

import type { FC, ReactNode } from "react";
import { AlertTriangleIcon, ArrowRightIcon } from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icons";

// ---------------------------------------------------------------------------
// HubPageLayout
// ---------------------------------------------------------------------------

export interface HubFooterItem {
  icon: IconComponent;
  label: string;
}

export interface HubPageLayoutProps {
  title: string;
  subtitle: string;
  footerItems?: HubFooterItem[];
  emptyIcon?: IconComponent;
  emptyMessage?: string;
  children: ReactNode;
  isEmpty?: boolean;
}

export const HubPageLayout: FC<HubPageLayoutProps> = ({
  title,
  subtitle,
  footerItems,
  emptyIcon: EmptyIcon = AlertTriangleIcon,
  emptyMessage,
  children,
  isEmpty = false,
}) => {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="pos-page-title text-ink">{title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
      </div>

      {/* Grid or empty state */}
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-16 text-ink-muted">
          <EmptyIcon size={40} aria-hidden="true" />
          {emptyMessage ? <p className="mt-3 text-sm">{emptyMessage}</p> : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl">
          {children}
        </div>
      )}

      {/* Footer strip — always pinned to bottom for visual balance even when empty */}
      {footerItems && footerItems.length > 0 ? (
        <div className="mt-auto flex flex-wrap items-center gap-4 border-t border-border pt-8 text-xs text-ink-muted">
          {footerItems.map((item, idx) => {
            const Icon = item.icon;
            return (
              <span key={idx} className="inline-flex items-center gap-1.5">
                <Icon size={12} aria-hidden="true" />
                {item.label}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// HubCard
// ---------------------------------------------------------------------------

export interface HubCardProps {
  title: string;
  description: string;
  icon: IconComponent;
  onClick: () => void;
  badge?: number;
  badgeVariant?: "info" | "warning" | "success";
  /** Optional test id for e2e / unit tests. */
  "data-testid"?: string;
}

export const HubCard: FC<HubCardProps> = ({
  title,
  description,
  icon: Icon,
  onClick,
  badge,
  badgeVariant = "info",
  "data-testid": dataTestId,
}) => {
  const showBadge = badge !== undefined && badge > 0;
  const badgeLabel = showBadge ? (badge! > 99 ? "99+" : String(badge)) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={dataTestId}
      className="group relative flex flex-col items-start gap-4 rounded bg-panel p-6 text-left shadow-pos-panel transition-all hover:shadow-pos-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-pharma cursor-pointer"
    >
      {/* Icon circle */}
      <div className="flex h-12 w-12 items-center justify-center rounded bg-pharma/10 text-pharma transition-colors group-hover:bg-pharma/15">
        <Icon size={24} aria-hidden="true" />
      </div>

      {/* Content */}
      <div className="flex-1 pr-6">
        <h3 className="text-base font-semibold text-ink leading-tight">{title}</h3>
        <p className="mt-1 text-sm leading-snug text-ink-muted">{description}</p>
      </div>

      {/* Arrow indicator */}
      <span
        className="absolute bottom-4 right-4 text-ink-muted transition-colors group-hover:text-pharma"
        aria-hidden="true"
      >
        <ArrowRightIcon size={16} />
      </span>

      {/* Badge */}
      {showBadge ? (
        <span
          className={`absolute right-4 top-4 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${
            badgeVariant === "warning"
              ? "bg-urgency-surface text-urgency"
              : badgeVariant === "success"
                ? "bg-success-container text-success"
                : "bg-pharma/10 text-pharma"
          }`}
          aria-label={`${badgeLabel} pendientes`}
        >
          {badgeLabel}
        </span>
      ) : null}
    </button>
  );
};
