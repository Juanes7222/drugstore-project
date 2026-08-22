/**
 * Hook that owns all state and event handlers for the sales transaction screen.
 *
 * Extracted from the inline implementation in sales-transaction.tsx so the
 * add-to-cart logic, restricted-item confirmation flow, and checkout
 * transition can be unit-tested without rendering the full split-panel UI.
 *
 * On checkout the hook calls `SalesPosService.create()` to persist the sale
 * (IN_PROGRESS) in the local DB, then navigates to the payment screen.
 */

import { useCallback, useMemo, useState } from 'react';
import { Prisma } from '@pharmacy/database/local';
import i18n from '@/i18n';
import { formatCurrency } from '@/utils/format-currency';
import {
  PriceBelowCostException,
  DiscountExceedsRoleLimitException,
  PriceOverrideNotAllowedForRoleException,
  ProductNotSyncedYetException,
} from '../../domain/sales-pos/exceptions';
import {
  addItem,
  selectCartItems,
  selectSelectedClient,
  selectGrandTotalCents,
  selectDeliveryDraft,
  setClient,
} from '@/store/slices/sales-slice';
import { initializePayment } from '@/store/slices/payment-slice';
import { setActiveScreen, setCurrentSaleId } from '@/store/slices/ui-slice';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  useClientsService,
  useSalesPosService,
} from '../components/common/service-context';
import { useProductSyncWait } from './use-product-sync-wait';
import type { CreateClientInput } from '../../domain/clients';
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
  /** Contact data used to prefill the delivery form; null when unknown. */
  address?: string | null;
  phone?: string | null;
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
  /** Total due including any delivery fee (what payment validates against). */
  grandTotalCents: number;
  /** True while the sale is being created in the local DB. */
  isCreating: boolean;
  /** True while a blocking product-sync is in progress. */
  isSyncingProduct: boolean;
  /** Error message from a failed create() call, or null. */
  actionError: string | null;
  /** Clear the current action error. */
  clearActionError: () => void;
  /** Called when a product is selected from the search results. */
  handleSelect: (item: CatalogItem, quantity?: number) => void;
  /** Confirm the restricted-item dialog and add to cart. */
  handleConfirmRestricted: () => void;
  /** Cancel the restricted-item dialog. */
  handleCancelRestricted: () => void;
  /** Persist cart as IN_PROGRESS sale in DB, then navigate to payment. */
  handleCheckout: () => Promise<void>;
  /** Assign a client to the current sale. */
  handleSelectClient: (client: ClientSelection) => void;
  /** Clear the selected client. */
  handleClearClient: () => void;
  /**
   * Create a new client and auto-select it for the current sale.
   * Returns the client selection so the caller can update UI optimistically.
   */
  handleCreateClient: (input: CreateClientInput) => Promise<ClientSelection>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSalesTransaction(): UseSalesTransactionReturn {
  const dispatch = useAppDispatch();
  const grandTotalCents = useAppSelector(selectGrandTotalCents);
  const selectedClient = useAppSelector(selectSelectedClient);
  const cartItems = useAppSelector(selectCartItems);
  const deliveryDraft = useAppSelector(selectDeliveryDraft);
  const salesPosService = useSalesPosService();
  const clientsService = useClientsService();

  const catalogService = useMemo<CatalogService>(() => createCatalogService(), []);

  const [pendingItem, setPendingItem] = useState<CatalogItem | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSyncingProduct, setIsSyncingProduct] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const clearActionError = useCallback(() => setActionError(null), []);
  const waitForProductSync = useProductSyncWait();

  const addToCart = useCallback(
    (item: CatalogItem, quantity = 1) => {
      if (item.unitPriceCents === null) return;

      dispatch(
        addItem({
          id: `${item.id}::${item.lotCode}`,
          productId: item.id,
          name: item.name,
          invimaCertificate: item.invimaCertificate ?? '',
          saleType: item.saleType,
          requiresPrescription: item.requiresPrescription,
          isRestricted: isCatalogItemRestricted(item),
          lotCode: item.lotCode,
          lotExpirationDate: item.lotExpirationDate,
          unitPriceCents: item.unitPriceCents,
          overrideUnitPriceCents: null,
          discountPercentage: null,
          costCents: item.costCents,
          taxPercentage: item.taxPercentage,
          quantity,
          commissionType: item.commissionType,
          commissionValue: item.commissionValue,
          commissionStartsAt: item.commissionStartsAt,
          commissionEndsAt: item.commissionEndsAt,
        }),
      );
    },
    [dispatch],
  );

  const handleSelect = useCallback(
    (item: CatalogItem, quantity = 1) => {
      if (!item.hasCompleteData || item.unitPriceCents === null) return;

      if (isCatalogItemRestricted(item)) {
        setPendingItem(item);
        setIsDialogOpen(true);
        return;
      }

      addToCart(item, quantity);
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

  const handleCreateClient = useCallback(
    async (input: CreateClientInput): Promise<ClientSelection> => {
      const created = await clientsService.create(input);
      const selection: ClientSelection = {
        id: created.id,
        name: created.fullName,
        identification: `${created.identificationType}: ${created.identificationNumber}`,
        address: created.address,
        phone: created.phone,
      };
      dispatch(setClient(selection));
      return selection;
    },
    [clientsService, dispatch],
  );

  const performCreate = useCallback(async () => {
    return await salesPosService.create({
      clientId: selectedClient?.id ?? null,
      delivery: deliveryDraft ?? null,
      items: cartItems.map((item) => {
        const unitPriceOverride =
          item.overrideUnitPriceCents !== null
            ? new Prisma.Decimal(item.overrideUnitPriceCents).dividedBy(100)
            : undefined;

        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: unitPriceOverride,
          discountPercentage: item.discountPercentage ?? undefined,
          discountReason:
            item.discountPercentage !== null && item.discountPercentage > 0
              ? 'Ajuste manual en POS'
              : undefined,
        };
      }),
    });
  }, [selectedClient, cartItems, deliveryDraft, salesPosService]);

  const handleCheckout = useCallback(async () => {
    if (isCreating || cartItems.length === 0) return;

    setIsCreating(true);
    setActionError(null);

    try {
      const sale = await performCreate();

      // Store sale ID for the payment screen to consume on confirm()
      dispatch(setCurrentSaleId((sale as { id: string }).id));
      dispatch(initializePayment({ totalCents: grandTotalCents }));
      dispatch(setActiveScreen('payment'));
    } catch (err) {
      // If the failure is a single unsynced product, kick the sync
      // engine and wait for the product to land on the server before
      // re-running create(). The cashier sees the syncing indicator
      // and the retry happens transparently if it lands in time.
      if (err instanceof ProductNotSyncedYetException) {
        setIsSyncingProduct(true);
        const synced = await waitForProductSync(err.productId);
        setIsSyncingProduct(false);
        if (synced) {
          try {
            const sale = await performCreate();
            dispatch(setCurrentSaleId((sale as { id: string }).id));
            dispatch(initializePayment({ totalCents: grandTotalCents }));
            dispatch(setActiveScreen('payment'));
            return;
          } catch (retryErr) {
            console.error('[useSalesTransaction] retry after sync failed:', retryErr);
            setActionError(i18n.t("sales.cart.error_product_not_synced_yet"));
            return;
          }
        }
        setActionError(i18n.t("sales.cart.error_product_not_synced_yet"));
        return;
      }

      if (err instanceof PriceBelowCostException) {
        const itemName =
          cartItems.find((ci) => ci.productId === err.productId)?.name ??
          err.productId;
        setActionError(
          i18n.t("sales.cart.error_price_below_cost", {
            name: itemName,
            price: formatCurrency(err.attemptedPrice),
            floor: formatCurrency(err.floorPrice),
          }),
        );
      } else if (err instanceof DiscountExceedsRoleLimitException) {
        setActionError(i18n.t("sales.cart.error_discount_exceeds_limit"));
      } else if (err instanceof PriceOverrideNotAllowedForRoleException) {
        setActionError(i18n.t("sales.cart.error_override_not_allowed"));
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setActionError(i18n.t("sales.cart.error_checkout_failed") + " " + message);
      }
    } finally {
      setIsCreating(false);
    }
  }, [
    isCreating,
    cartItems,
    performCreate,
    waitForProductSync,
    dispatch,
    grandTotalCents,
  ]);

  return {
    catalogService,
    pendingItem,
    isDialogOpen,
    selectedClient,
    grandTotalCents,
    isCreating,
    isSyncingProduct,
    actionError,
    clearActionError,
    handleSelect,
    handleConfirmRestricted,
    handleCancelRestricted,
    handleCheckout,
    handleSelectClient,
    handleClearClient,
    handleCreateClient,
  };
}
