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
  navigateToInventoryCount,
} from "@/store/slices/ui-slice";
import { useLocalSessionStore, hasMinRole } from "../../../domain/auth/local-session.store";
import { useRequireLotOnReception } from "../../../domain/configuration";
import { RoleType } from "@pharmacy/shared-types";
import { BarcodeIcon, ClipboardListIcon, PackageIcon, ScaleIcon, TruckIcon } from "@/components/ui/icons";
import { HubCard, HubPageLayout } from "@/components/ui/hub";

// ---------------------------------------------------------------------------
// Card type
// ---------------------------------------------------------------------------

interface ProductosCard {
  key: string;
  titleKey: string;
  descriptionKey: string;
  icon: FC<{ size?: number; className?: string }>;
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
      {
        key: "count",
        titleKey: "productos_main.card_count_title",
        descriptionKey: "productos_main.card_count_desc",
        icon: ScaleIcon,
        onClick: () => dispatch(navigateToInventoryCount()),
        requiredRole: RoleType.INVENTORY_ASSISTANT,
      },
    ],
    [dispatch, lotManagementOff],
  );

  const visibleCards = cards.filter((card) =>
    session ? hasMinRole(session, card.requiredRole) : false,
  );

  return (
    <HubPageLayout
      title={t("productos_main.title")}
      subtitle={t("productos_main.subtitle")}
      isEmpty={visibleCards.length === 0}
      emptyMessage={t("productos_main.no_access")}
      footerItems={[
        { icon: PackageIcon, label: t("productos_main.title") },
        { icon: TruckIcon, label: t("purchases.main.offlineReady") },
      ]}
    >
      {visibleCards.map((card) => (
        <HubCard
          key={card.key}
          icon={card.icon}
          title={t(card.titleKey)}
          description={t(card.descriptionKey)}
          onClick={card.onClick}
        />
      ))}
    </HubPageLayout>
  );
};
