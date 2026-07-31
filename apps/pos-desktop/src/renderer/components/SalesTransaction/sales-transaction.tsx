/**
 * Sales / Cart screen.
 *
 * Thin wiring container — delegates all state and effects to the
 * useSalesTransaction hook and renders the split-panel layout.
 *
 * Left panel: product search with help bar and scrollable results.
 * Right panel: client selector, cart items, totals, and checkout button.
 */
import { type FC } from "react";
import { useSalesTransaction } from "../../hooks/use-sales-transaction";
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

  return (
    <div className="grid h-full grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-pos-md p-pos-md lg:grid-cols-[minmax(0,60%)_minmax(0,40%)] lg:grid-rows-1">
      <ProductSearch
        catalogService={catalogService}
        onSelect={handleSelect}
      />
      <CartPanel
        onCheckout={handleCheckout}
        onSelectClient={handleSelectClient}
        onClearClient={handleClearClient}
        onCreateClient={handleCreateClient}
        actionError={actionError}
        onClearError={clearActionError}
        isCreating={isCreating}
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
