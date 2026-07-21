/**
 * Productos-main page — intermediate hub for product-related sub-pages.
 *
 * Shows role-gated cards that navigate to Products, Lots, and Inventory
 * Adjustments. Replaces 3 separate sidebar entries with a single
 * "Productos" entry + this hub page.
 *
 * @category Page
 */

import { type FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch } from "@/store/hooks";
import {
  navigateToProducts,
  navigateToInventoryLots,
  navigateToInventoryAdjustments,
} from "@/store/slices/ui-slice";
import { useLocalSessionStore, hasMinRole } from "../../../domain/auth/local-session.store";
import { RoleType } from "@pharmacy/shared-types";

// ---------------------------------------------------------------------------
// SVG icon components for each card
// ---------------------------------------------------------------------------

const PackageIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M16.5 9.4 7.55 4.24" />
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.29 7 12 12 20.71 7" />
    <line x1="12" y1="22" x2="12" y2="12" />
  </svg>
);

const BarcodeIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2 7h2v10H2z" />
    <path d="M6 7h1v10H6z" />
    <path d="M9 7h2v10H9z" />
    <path d="M13 7h1v10h-1z" />
    <path d="M16 7h1v10h-1z" />
    <path d="M19 7h1v10h-1z" />
    <path d="M22 7h1v10h-1z" />
  </svg>
);

const ClipboardIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="8" y1="9" x2="16" y2="9" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="12" y2="17" />
  </svg>
);

// ---------------------------------------------------------------------------
// Card type
// ---------------------------------------------------------------------------

interface ProductosCard {
  key: string;
  titleKey: string;
  descriptionKey: string;
  icon: FC<{ className?: string }>;
  onClick: () => void;
  requiredRole: RoleType;
}

// ---------------------------------------------------------------------------
// ProductosMainPage component
// ---------------------------------------------------------------------------

export const ProductosMainPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const session = useLocalSessionStore((s) => s.session);

  const cards: ProductosCard[] = useMemo(
    () => [
      {
        key: "products",
        titleKey: "productos_main.card_products_title",
        descriptionKey: "productos_main.card_products_desc",
        icon: PackageIcon,
        onClick: () => dispatch(navigateToProducts()),
        requiredRole: RoleType.INVENTORY_ASSISTANT,
      },
      {
        key: "lots",
        titleKey: "productos_main.card_lots_title",
        descriptionKey: "productos_main.card_lots_desc",
        icon: BarcodeIcon,
        onClick: () => dispatch(navigateToInventoryLots()),
        requiredRole: RoleType.INVENTORY_ASSISTANT,
      },
      {
        key: "adjustments",
        titleKey: "productos_main.card_adjustments_title",
        descriptionKey: "productos_main.card_adjustments_desc",
        icon: ClipboardIcon,
        onClick: () => dispatch(navigateToInventoryAdjustments()),
        requiredRole: RoleType.MANAGER,
      },
    ],
    [dispatch],
  );

  const visibleCards = cards.filter((card) =>
    session ? hasMinRole(session, card.requiredRole) : false,
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-heading-lg font-semibold" style={{ color: "var(--color-ink-text)" }}>
          {t("productos_main.title")}
        </h1>
        <p className="text-body-sm mt-1" style={{ color: "var(--color-ink-muted)" }}>
          {t("productos_main.subtitle")}
        </p>
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {visibleCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.key}
              type="button"
              onClick={card.onClick}
              className="flex flex-col items-start gap-4 rounded-lg border p-6 text-left transition-all duration-200 hover:shadow-md focus:outline-none focus-visible:ring-2"
              style={{
                borderColor: "var(--color-border-base)",
                backgroundColor: "var(--color-surface-base)",
                color: "var(--color-ink-text)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--color-accent-base)";
                e.currentTarget.style.backgroundColor = "var(--color-surface-raised)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--color-border-base)";
                e.currentTarget.style.backgroundColor = "var(--color-surface-base)";
              }}
            >
              <div
                className="flex h-14 w-14 items-center justify-center rounded-lg"
                style={{ backgroundColor: "var(--color-accent-subtle)", color: "var(--color-accent-base)" }}
              >
                <Icon className="h-8 w-8" />
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-heading-sm font-medium">
                  {t(card.titleKey)}
                </span>
                <span className="text-body-sm" style={{ color: "var(--color-ink-muted)" }}>
                  {t(card.descriptionKey)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Empty state when no cards accessible */}
      {visibleCards.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-body-sm" style={{ color: "var(--color-ink-muted)" }}>
            {t("productos_main.no_access")}
          </p>
        </div>
      )}
    </div>
  );
};
