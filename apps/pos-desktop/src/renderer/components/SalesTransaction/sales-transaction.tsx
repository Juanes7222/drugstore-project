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
    handleSelect,
    handleConfirmRestricted,
    handleCancelRestricted,
    handleCheckout,
    handleSelectClient,
    handleClearClient,
    handleCreateClient,
  } = useSalesTransaction();

  return (
    <div className="grid h-full grid-cols-[60%_40%] gap-pos-md p-pos-md">
      <ProductSearch
        catalogService={catalogService}
        onSelect={handleSelect}
      />
      <CartPanel
        onCheckout={handleCheckout}
        onSelectClient={handleSelectClient}
        onClearClient={handleClearClient}
        onCreateClient={handleCreateClient}
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
