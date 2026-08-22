/**
 * Quick product buttons for the sales screen.
 *
 * Cashiers sell the same fast-movers all day (acetaminofén, ibuprofeno…).
 * This hook exposes the pinned-product list from the user preferences store
 * and resolves a pinned id to a catalog item on click. Pinning happens on
 * the search result card ("pin" action); the buttons are rendered by the
 * frontend layer above the search input.
 *
 * Resolution goes through the same `onAddCatalogItem` bridge as search
 * submit, so restricted products still open the confirmation dialog and
 * quantity defaults to 1.
 */
import { useCallback } from "react";
import {
  type CatalogItem,
  type CatalogService,
} from "@/services/catalog-service";
import { useUserPreferencesStore } from "../../stores/user-preferences.store";

export interface UseQuickButtonsDeps {
  catalogService: CatalogService;
  /** Add a catalog item to the cart (handleSelect — opens restricted dialog). */
  onAddCatalogItem: (item: CatalogItem, quantity?: number) => void;
}

export interface UseQuickButtonsReturn {
  /** Pinned product ids, insertion order. */
  quickProductIds: string[];
  /** Whether a product is currently pinned. */
  isPinned: (productId: string) => boolean;
  /** Pin/unpin a product. */
  togglePin: (productId: string) => void;
  /**
   * Resolve a pinned product and add it to the cart. Returns false when the
   * product is gone, inactive, or lacks complete data.
   */
  addQuickProduct: (productId: string) => Promise<boolean>;
}

export function useQuickButtons({
  catalogService,
  onAddCatalogItem,
}: UseQuickButtonsDeps): UseQuickButtonsReturn {
  const quickProductIds = useUserPreferencesStore((s) => s.quickButtons);
  const addQuickButton = useUserPreferencesStore((s) => s.addQuickButton);
  const removeQuickButton = useUserPreferencesStore(
    (s) => s.removeQuickButton,
  );

  const isPinned = useCallback(
    (productId: string) => quickProductIds.includes(productId),
    [quickProductIds],
  );

  const togglePin = useCallback(
    (productId: string) => {
      if (quickProductIds.includes(productId)) {
        removeQuickButton(productId);
      } else {
        addQuickButton(productId);
      }
    },
    [quickProductIds, addQuickButton, removeQuickButton],
  );

  const addQuickProduct = useCallback(
    async (productId: string): Promise<boolean> => {
      const item = await catalogService.getById(productId);
      if (!item || !item.hasCompleteData || item.unitPriceCents === null) {
        return false;
      }
      onAddCatalogItem(item, 1);
      return true;
    },
    [catalogService, onAddCatalogItem],
  );

  return { quickProductIds, isPinned, togglePin, addQuickProduct };
}