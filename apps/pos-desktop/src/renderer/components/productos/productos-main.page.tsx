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
import { useRequireLotOnReception } from "../../../domain/configuration";
import { RoleType } from "@pharmacy/shared-types";
import { BarcodeIcon, ClipboardListIcon, PackageIcon } from "@/components/ui/icons";

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
  const requireLotOnReception = useRequireLotOnReception();
  const lotManagementOff = !requireLotOnReception;

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
      ...(lotManagementOff
        ? ([] as ProductosCard[])
        : [
            {
              key: "lots",
              titleKey: "productos_main.card_lots_title",
              descriptionKey: "productos_main.card_lots_desc",
              icon: BarcodeIcon,
              onClick: () => dispatch(navigateToInventoryLots()),
              requiredRole: RoleType.INVENTORY_ASSISTANT,
            } as ProductosCard,
          ]),
      {
        key: "adjustments",
        titleKey: "productos_main.card_adjustments_title",
        descriptionKey: "productos_main.card_adjustments_desc",
        icon: ClipboardListIcon,
        onClick: () => dispatch(navigateToInventoryAdjustments()),
        requiredRole: RoleType.MANAGER,
      },
    ],
    [dispatch, lotManagementOff],
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
