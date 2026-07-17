/**
 * Hook that owns all state and event handlers for the sales transaction screen.
 *
 * Extracted from the inline implementation in sales-transaction.tsx so the
 * add-to-cart logic, restricted-item confirmation flow, and checkout
 * transition can be unit-tested without rendering the full split-panel UI.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  addItem,
  selectSelectedClient,
  selectTotalCents,
  setClient,
} from '@/store/slices/sales-slice';
import { initializePayment } from '@/store/slices/payment-slice';
import { setActiveScreen } from '@/store/slices/ui-slice';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  type CatalogItem,
  type CatalogService,
  isCatalogItemRestricted,
} from '@/services/catalog-service';
import { createCatalogService } from '@infra/catalog-service-factory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientSelection {
  id: string;
  name: string;
  identification: string;
}

export interface UseSalesTransactionReturn {
  /** The memoised catalog service instance. */
  catalogService: CatalogService;
  /** Item awaiting restricted-sale confirmation, or null. */
  pendingItem: CatalogItem | null;
  /** Whether the restricted-item confirmation dialog is open. */
  isDialogOpen: boolean;
  /** Client selected for the current sale, or null. */
  selectedClient: ClientSelection | null;
  /** Called when a product is selected from the search results. */
  handleSelect: (item: CatalogItem) => void;
  /** Confirm the restricted-item dialog and add to cart. */
  handleConfirmRestricted: () => void;
  /** Cancel the restricted-item dialog. */
  handleCancelRestricted: () => void;
  /** Transition to the payment screen. */
  handleCheckout: () => void;
  /** Assign a client to the current sale. */
  handleSelectClient: (client: ClientSelection) => void;
  /** Clear the selected client. */
  handleClearClient: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSalesTransaction(): UseSalesTransactionReturn {
  const dispatch = useAppDispatch();
  const totalDue = useAppSelector(selectTotalCents);
  const selectedClient = useAppSelector(selectSelectedClient);

  const catalogService = useMemo<CatalogService>(() => createCatalogService(), []);

  const [pendingItem, setPendingItem] = useState<CatalogItem | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const addToCart = useCallback(
    (item: CatalogItem) => {
      if (item.unitPriceCents === null) return;

      dispatch(
        addItem({
          id: `${item.id}::${item.lotCode}`,
          productId: item.id,
          name: item.name,
          genericName: item.genericName,
          invimaCertificate: item.invimaCertificate ?? '',
          saleType: item.saleType,
          requiresPrescription: item.requiresPrescription,
          isRestricted: isCatalogItemRestricted(item),
          lotCode: item.lotCode,
          lotExpirationDate: item.lotExpirationDate,
          unitPriceCents: item.unitPriceCents,
          taxPercentage: item.taxPercentage,
          quantity: 1,
        }),
      );
    },
    [dispatch],
  );

  const handleSelect = useCallback(
    (item: CatalogItem) => {
      if (!item.hasCompleteData || item.unitPriceCents === null) return;

      if (isCatalogItemRestricted(item)) {
        setPendingItem(item);
        setIsDialogOpen(true);
        return;
      }

      addToCart(item);
    },
    [addToCart],
  );

  const handleConfirmRestricted = useCallback(() => {
    if (!pendingItem) return;

    addToCart(pendingItem);
    setPendingItem(null);
    setIsDialogOpen(false);
  }, [pendingItem, addToCart]);

  const handleCancelRestricted = useCallback(() => {
    setPendingItem(null);
    setIsDialogOpen(false);
  }, []);

  const handleSelectClient = useCallback(
    (client: ClientSelection) => {
      dispatch(setClient(client));
    },
    [dispatch],
  );

  const handleClearClient = useCallback(() => {
    dispatch(setClient(null));
  }, [dispatch]);

  const handleCheckout = useCallback(() => {
    dispatch(initializePayment({ totalCents: totalDue }));
    dispatch(setActiveScreen('payment'));
  }, [dispatch, totalDue]);

  return {
    catalogService,
    pendingItem,
    isDialogOpen,
    selectedClient,
    handleSelect,
    handleConfirmRestricted,
    handleCancelRestricted,
    handleCheckout,
    handleSelectClient,
    handleClearClient,
  };
}
