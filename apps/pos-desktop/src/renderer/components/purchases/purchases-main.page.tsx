/**
 * Purchases-main page — hub for purchase-related sub-pages.
 *
 * Role-gated cards navigate to Suppliers, Purchase Orders, Receptions,
 * and Supplier Returns. Uses lucide-react icons per design-system.md.
 * Shows pending counts for each section.
 *
 * @category Page
 */

import { type FC, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Building2,
  FileText,
  PackageCheck,
  Undo2,
  ArrowRight,
  ClipboardList,
  Truck,
  AlertTriangle,
} from 'lucide-react';
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
        icon: Building2,
        onClick: () => dispatch(navigateToSuppliers()),
        requiredRole: RoleType.INVENTORY_ASSISTANT,
      },
      {
        key: 'purchase-orders',
        titleKey: 'purchases.main.ordersTitle',
        descriptionKey: 'purchases.main.ordersDesc',
        icon: FileText,
        onClick: () => dispatch(navigateToPurchaseOrders()),
        requiredRole: RoleType.INVENTORY_ASSISTANT,
        badge: pendingOrdersCount,
        badgeVariant: pendingOrdersCount > 0 ? 'warning' : 'info',
      },
      {
        key: 'purchase-receptions',
        titleKey: 'purchases.main.receptionsTitle',
        descriptionKey: 'purchases.main.receptionsDesc',
        icon: PackageCheck,
        onClick: () => dispatch(navigateToPurchaseReceptions()),
        requiredRole: RoleType.INVENTORY_ASSISTANT,
        badge: pendingReceptionsCount,
        badgeVariant: pendingReceptionsCount > 0 ? 'warning' : 'info',
      },
      {
        key: 'supplier-returns',
        titleKey: 'purchases.main.returnsTitle',
        descriptionKey: 'purchases.main.returnsDesc',
        icon: Undo2,
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
    <div className="flex flex-col h-full p-6 bg-surface">
      {/* Header */}
      <div className="mb-8">
        <h1 className="pos-page-title">{t('purchases.main.title')}</h1>
        <p className="text-sm text-ink-muted mt-1">
          {t('purchases.main.subtitle')}
        </p>
      </div>

      {visibleCards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-ink-muted">
          <AlertTriangle size={40} aria-hidden="true" />
          <p className="mt-3 text-sm">{t('purchases.main.noAccess')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-3xl">
          {visibleCards.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.key}
                type="button"
                onClick={card.onClick}
                className="group relative flex flex-col items-start gap-4 p-6 bg-panel rounded shadow-pos-panel hover:shadow-pos-elevated transition-all text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-pharma"
              >
                {/* Icon circle */}
                <div className="flex items-center justify-center w-12 h-12 rounded bg-pharma/10 text-pharma group-hover:bg-pharma/15 transition-colors">
                  <Icon size={24} aria-hidden="true" />
                </div>

                {/* Content */}
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-ink">
                    {t(card.titleKey)}
                  </h3>
                  <p className="text-sm text-ink-muted mt-1 leading-snug">
                    {t(card.descriptionKey)}
                  </p>
                </div>

                {/* Arrow indicator */}
                <span className="absolute bottom-4 right-4 text-ink-muted group-hover:text-pharma transition-colors">
                  <ArrowRight size={16} aria-hidden="true" />
                </span>

                {/* Badge */}
                {card.badge !== undefined && card.badge > 0 && (
                  <span
                    className={`absolute top-4 right-4 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-xs font-semibold ${
                      card.badgeVariant === 'warning'
                        ? 'bg-urgency-surface text-urgency'
                        : 'bg-pharma/10 text-pharma'
                    }`}
                  >
                    {card.badge > 99 ? '99+' : card.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Module info footer */}
      <div className="mt-auto pt-8 border-t border-border text-xs text-ink-muted flex items-center gap-4">
        <span className="inline-flex items-center gap-1">
          <ClipboardList size={12} aria-hidden="true" />
          {t('purchases.main.moduleLabel')}
        </span>
        <span className="inline-flex items-center gap-1">
          <Truck size={12} aria-hidden="true" />
          {t('purchases.main.offlineReady')}
        </span>
      </div>
    </div>
  );
};
