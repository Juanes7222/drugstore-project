/**
 * Sales / Cart screen.
 *
 * Implements the left/right split from design-system.md: product search on
 * the left (60%), cart panel on the right (40%). Handles restricted-sale
 * confirmation before an item enters the cart.
 */
import { type FC, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { addItem } from "@/store/slices/sales-slice";
import { useAppDispatch } from "@/store/hooks";
import {
  CatalogItem,
  CatalogService,
  isCatalogItemRestricted,
  parsePriceToCents,
} from "@/services/catalog-service";
import { createMockCatalogService } from "@/services/catalog-service.mock";
import { ProductSearch } from "./product-search";
import { CartPanel } from "./cart-panel";
import { RestrictedConfirmationDialog } from "./restricted-confirmation-dialog";

export const SalesTransaction: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  // The service instance is memoized so the component renders with the same
  // implementation throughout its lifecycle. Replace `createMockCatalogService`
  // with the real Tauri-backed factory when the IPC layer is ready.
  const catalogService = useMemo<CatalogService>(
    () => createMockCatalogService(),
    [],
  );

  const [pendingItem, setPendingItem] = useState<CatalogItem | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleSelect = useCallback((item: CatalogItem) => {
    if (isCatalogItemRestricted(item)) {
      setPendingItem(item);
      setIsDialogOpen(true);
      return;
    }

    addToCart(item);
  }, []);

  const addToCart = useCallback((item: CatalogItem) => {
    dispatch(
      addItem({
        id: `${item.id}::${item.lotCode}`,
        productId: item.id,
        name: item.name,
        genericName: item.genericName,
        invimaCertificate: item.invimaCertificate,
        saleType: item.saleType,
        requiresPrescription: item.requiresPrescription,
        isRestricted: isCatalogItemRestricted(item),
        lotCode: item.lotCode,
        lotExpirationDate: item.lotExpirationDate,
        unitPriceCents: parsePriceToCents(item.sellingPrice),
        taxPercentage: Number.parseFloat(item.taxPercentage) || 19,
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
    // Phase 2 ends at the COBRAR button. Navigation to the Payment screen
    // will be implemented in a later phase.
    // eslint-disable-next-line no-console
    console.log(t("sales.cart.checkout"));
  }, [t]);

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
