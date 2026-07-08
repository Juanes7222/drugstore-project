/**
 * Sales / Cart screen.
 *
 * Implements the left/right split from design-system.md: product search on
 * the left (60%), cart panel on the right (40%). Handles restricted-sale
 * confirmation before an item enters the cart.
 */
import { type FC, useCallback, useMemo, useState } from "react";
import { addItem, selectTotalCents } from "@/store/slices/sales-slice";
import { initializePayment } from "@/store/slices/payment-slice";
import { setActiveScreen } from "@/store/slices/ui-slice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  CatalogItem,
  CatalogService,
  isCatalogItemRestricted,
} from "@/services/catalog-service";
import { createHttpCatalogService } from "@/services/catalog-service.http";
import { createMockCatalogService } from "@/services/catalog-service.mock";
import { createHttpClient } from "@/services/http-client";
import { createLocalStorageAuthTokenProvider } from "@/services/auth-token-provider";
import { ProductSearch } from "./product-search";
import { CartPanel } from "./cart-panel";
import { RestrictedConfirmationDialog } from "./restricted-confirmation-dialog";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined;

const createCatalogService = (): CatalogService => {
  if (!API_BASE_URL) {
    // Fallback to the mock when no server URL is configured. This keeps the
    // UI runnable in early development; production builds must set the env var.
    // eslint-disable-next-line no-console
    console.warn(
      "VITE_API_BASE_URL is not set; falling back to mock catalog service.",
    );
    return createMockCatalogService();
  }

  const httpClient = createHttpClient(
    API_BASE_URL,
    createLocalStorageAuthTokenProvider(),
  );

  return createHttpCatalogService({ httpClient });
};

export const SalesTransaction: FC = () => {
  const dispatch = useAppDispatch();
  const totalDue = useAppSelector(selectTotalCents);

  // The service instance is memoized so the component renders with the same
  // implementation throughout its lifecycle.
  const catalogService = useMemo<CatalogService>(
    () => createCatalogService(),
    [],
  );

  const [pendingItem, setPendingItem] = useState<CatalogItem | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleSelect = useCallback((item: CatalogItem) => {
    if (!item.hasCompleteData || item.unitPriceCents === null) {
      return;
    }

    if (isCatalogItemRestricted(item)) {
      setPendingItem(item);
      setIsDialogOpen(true);
      return;
    }

    addToCart(item);
  }, []);

  const addToCart = useCallback((item: CatalogItem) => {
    if (item.unitPriceCents === null) {
      return;
    }

    dispatch(
      addItem({
        id: `${item.id}::${item.lotCode}`,
        productId: item.id,
        name: item.name,
        genericName: item.genericName,
        invimaCertificate: item.invimaCertificate ?? "",
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
  }, [dispatch]);

  const handleConfirmRestricted = useCallback(() => {
    if (!pendingItem) {
      return;
    }

    addToCart(pendingItem);
    setPendingItem(null);
    setIsDialogOpen(false);
  }, [pendingItem, addToCart]);

  const handleCancelRestricted = useCallback(() => {
    setPendingItem(null);
    setIsDialogOpen(false);
  }, []);

  const handleCheckout = useCallback(() => {
    dispatch(initializePayment({ totalCents: totalDue }));
    dispatch(setActiveScreen("payment"));
  }, [dispatch, totalDue]);

  return (
    <div className="grid h-full grid-cols-[60%_40%] gap-pos-md p-pos-md">
      <ProductSearch
        catalogService={catalogService}
        onSelect={handleSelect}
      />
      <CartPanel onCheckout={handleCheckout} />

      <RestrictedConfirmationDialog
        item={pendingItem}
        open={isDialogOpen}
        onConfirm={handleConfirmRestricted}
        onCancel={handleCancelRestricted}
      />
    </div>
  );
};
