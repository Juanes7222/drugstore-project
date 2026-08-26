/**
 * Purchases-main page — hub for purchase-related sub-pages.
 *
 * Role-gated cards navigate to Suppliers, Purchase Orders, Receptions,
 * and Supplier Returns. Uses shared ui/icons components.
 * Shows pending counts for each section.
 *
 * @category Page
 */

import { type FC, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2Icon, ClipboardListIcon, FileTextIcon, PackageCheckIcon, TruckIcon, Undo2Icon } from "@/components/ui/icons";
import { HubCard, HubPageLayout } from "@/components/ui/hub";
import { useAppDispatch } from '@/store/hooks';
import {
  navigateToSuppliers,
  navigateToPurchaseOrders,
  navigateToPurchaseReceptions,
  navigateToSupplierReturns,
} from '@/store/slices/ui-slice';
import { useLocalSessionStore } from '../../../domain/auth/local-session.store';
import { RoleType } from '@pharmacy/shared-types';

// ── Card type ───────────────────────────────────────────────────────────

interface PurchasesCard {
  key: string;
  titleKey: string;
  descriptionKey: string;
  icon: FC<{ size?: number; className?: string }>;
  onClick: () => void;
  requiredRole: RoleType;
  badge?: number;
  badgeVariant?: 'info' | 'warning' | 'success';
}

// ── Page component ──────────────────────────────────────────────────────

export const PurchasesMainPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const session = useLocalSessionStore((s) => s.session);

  // Would connect to real counts from domain services in production
  const [pendingOrdersCount] = useState(0);
  const [pendingReceptionsCount] = useState(0);

  const cards: PurchasesCard[] = useMemo(
    () => [
      {
        key: 'suppliers',
        titleKey: 'purchases.main.suppliersTitle',
        descriptionKey: 'purchases.main.suppliersDesc',
        icon: Building2Icon,
        onClick: () => dispatch(navigateToSuppliers()),
        requiredRole: RoleType.INVENTORY_ASSISTANT,
      },
      {
        key: 'purchase-orders',
        titleKey: 'purchases.main.ordersTitle',
        descriptionKey: 'purchases.main.ordersDesc',
        icon: FileTextIcon,
        onClick: () => dispatch(navigateToPurchaseOrders()),
        requiredRole: RoleType.INVENTORY_ASSISTANT,
        badge: pendingOrdersCount,
        badgeVariant: pendingOrdersCount > 0 ? 'warning' : 'info',
      },
      {
        key: 'purchase-receptions',
        titleKey: 'purchases.main.receptionsTitle',
        descriptionKey: 'purchases.main.receptionsDesc',
        icon: PackageCheckIcon,
        onClick: () => dispatch(navigateToPurchaseReceptions()),
        requiredRole: RoleType.INVENTORY_ASSISTANT,
        badge: pendingReceptionsCount,
        badgeVariant: pendingReceptionsCount > 0 ? 'warning' : 'info',
      },
      {
        key: 'supplier-returns',
        titleKey: 'purchases.main.returnsTitle',
        descriptionKey: 'purchases.main.returnsDesc',
        icon: Undo2Icon,
        onClick: () => dispatch(navigateToSupplierReturns()),
        requiredRole: RoleType.INVENTORY_ASSISTANT,
      },
    ],
    [dispatch, pendingOrdersCount, pendingReceptionsCount],
  );

  const userRole = session?.role as RoleType | undefined;
  const visibleCards = useMemo(
    () =>
      userRole
        ? cards.filter((c) => {
            const roleRank: Record<RoleType, number> = {
              [RoleType.CASHIER]: 0,
              [RoleType.INVENTORY_ASSISTANT]: 1,
              [RoleType.ADMIN]: 2,
              [RoleType.ACCOUNTANT]: 2,
              [RoleType.MANAGER]: 3,
              [RoleType.OWNER]: 4,
              [RoleType.SAAS_ADMIN]: 5,
            };
            return (roleRank[userRole] ?? 0) >= (roleRank[c.requiredRole] ?? 0);
          })
        : [],
    [cards, userRole],
  );

  return (
    <HubPageLayout
      title={t('purchases.main.title')}
      subtitle={t('purchases.main.subtitle')}
      isEmpty={visibleCards.length === 0}
      emptyMessage={t('purchases.main.noAccess')}
      footerItems={[
        { icon: ClipboardListIcon, label: t('purchases.main.moduleLabel') },
        { icon: TruckIcon, label: t('purchases.main.offlineReady') },
      ]}
    >
      {visibleCards.map((card) => (
        <HubCard
          key={card.key}
          icon={card.icon}
          title={t(card.titleKey)}
          description={t(card.descriptionKey)}
          onClick={card.onClick}
          badge={card.badge}
          badgeVariant={card.badgeVariant}
        />
      ))}
    </HubPageLayout>
  );
};
