/**
 * Sales / Cart screen.
 *
 * Thin wiring container — delegates all state and effects to the
 * useSalesTransaction and useSalesKeyboard hooks and renders the
 * split-panel layout.
 *
 * Left panel: product search with help bar and scrollable results.
 * Right panel: client selector, cart items, totals, and checkout button.
 */
import { type FC, useCallback, useRef } from "react";
import { useSalesTransaction } from "../../hooks/use-sales-transaction";
import { useSalesKeyboard } from "../../hooks/use-sales-keyboard";
import { useQuickButtons } from "../../hooks/use-quick-buttons";
import { ProductSearch } from "./product-search";
import { CartPanel } from "./cart-panel";
import { RestrictedConfirmationDialog } from "./restricted-confirmation-dialog";

export const SalesTransaction: FC = () => {
  const {
    catalogService,
    pendingItem,
    isDialogOpen,
    actionError,
    clearActionError,
    isCreating,
    handleSelect,
    handleConfirmRestricted,
    handleCancelRestricted,
    handleCheckout,
    handleSelectClient,
    handleClearClient,
    handleCreateClient,
  } = useSalesTransaction();

  const searchInputRef = useRef<HTMLInputElement>(null);

  const { quickProductIds, isPinned, togglePin, addQuickProduct } =
    useQuickButtons({
      catalogService,
      onAddCatalogItem: handleSelect,
    });

  // F2–F6 from the keyboard hook map to the pinned fast-movers 0–4; an
  // index with no pin simply does nothing.
  const handleQuickSelect = useCallback(
    (index: number) => {
      const productId = quickProductIds[index];
      if (productId) {
        void addQuickProduct(productId);
      }
    },
    [quickProductIds, addQuickProduct],
  );

  const {
    quickEdit,
    setQuickEditDraft,
    commitQuickEdit,
    cancelQuickEdit,
    submitSearch,
    feedback,
  } = useSalesKeyboard({
    catalogService,
    isDialogOpen,
    isCreating,
    onAddCatalogItem: handleSelect,
    onCheckout: handleCheckout,
    onQuickSelect: handleQuickSelect,
  });

  // After a quick edit closes, hand focus back to the search input so the
  // scanner flow resumes without a mouse.
  const handleQuickEditDone = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  return (
    <div className="grid h-full grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-pos-md p-pos-md lg:grid-cols-[minmax(0,60%)_minmax(0,40%)] lg:grid-rows-1">
      <ProductSearch
        catalogService={catalogService}
        onSelect={handleSelect}
        searchInputRef={searchInputRef}
        onSubmitSearch={submitSearch}
        feedback={feedback}
        quickProductIds={quickProductIds}
        onAddQuickProduct={(productId) => {
          void addQuickProduct(productId);
        }}
        onTogglePin={togglePin}
        isPinned={isPinned}
      />
      <CartPanel
        onCheckout={handleCheckout}
        onSelectClient={handleSelectClient}
        onClearClient={handleClearClient}
        onCreateClient={handleCreateClient}
        actionError={actionError}
        onClearError={clearActionError}
        isCreating={isCreating}
        quickEdit={quickEdit}
        onQuickEditDraftChange={setQuickEditDraft}
        onQuickEditCommit={commitQuickEdit}
        onQuickEditCancel={cancelQuickEdit}
        onQuickEditDone={handleQuickEditDone}
      />

      <RestrictedConfirmationDialog
        item={pendingItem}
        open={isDialogOpen}
        onConfirm={handleConfirmRestricted}
        onCancel={handleCancelRestricted}
      />
    </div>
  );
};