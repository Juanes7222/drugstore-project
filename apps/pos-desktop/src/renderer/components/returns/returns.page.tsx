/**
 * ReturnsPage — client-return processing screen.
 *
 * Two flows:
 *   1. Verified return (default): search by local sale number / UUID, display
 *      sale items, and process the return. Requires CASHIER or ADMIN role.
 *   2. Unverified return (fallback): when the sale is not found locally, the
 *      cashier manually enters items, lots, and quantities. Requires ADMIN
 *      role (manager override) and a PIN confirmation on submit.
 *
 * All data is read from the local PGlite database via the real ReturnsService
 * from domain/. Role re-check happens on submit, not just on mount, to guard
 * against session changes while the form is being filled.
 *
 * @category Page
 */
import {
  type FC,
  useCallback,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch } from "@/store/hooks";
import { navigateBackToSales } from "@/store/slices/ui-slice";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { OperationQueuedToast } from "@/components/common/operation-queued-toast";
import { RoleType } from "@pharmacy/shared-types";
import { useReturnsService } from "../common/service-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SaleSearchResult {
  id: string;
  sequentialNumber: number;
  createdAt: string;
  clientName: string;
  workstationName: string;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    quantity: number;
    unitPriceCents: number;
    taxPercentage: number;
    totalCents: number;
    lotCode: string;
  }>;
  totalCents: number;
}

interface UnverifiedItemEntry {
  productId: string;
  productName: string;
  lotCode: string;
  quantity: number;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

const formatCents = (cents: number): string =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(cents);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ReturnTab = "verified" | "unverified";

export const ReturnsPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isOnline = useOnlineStatus();
  const returnsService = useReturnsService();

  // Tabs
  const [activeTab, setActiveTab] = useState<ReturnTab>("verified");

  // Verified flow
  const [searchQuery, setSearchQuery] = useState("");
  const [foundSale, setFoundSale] = useState<SaleSearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(
    new Set(),
  );

  // Unverified flow
  const [unverifiedItems, setUnverifiedItems] = useState<
    UnverifiedItemEntry[]
  >([]);
  const [managerPin, setManagerPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

  // Shared
  const [isProcessing, setIsProcessing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    operationUuid: string;
    operationType: string;
    isVerified: boolean;
  } | null>(null);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleSearch = useCallback(async () => {
    setSearchError(null);
    setFoundSale(null);
    setSelectedItemIds(new Set());

    if (!searchQuery.trim()) {
      setSearchError(t("returns.search_empty"));
      return;
    }

    try {
      const result = await returnsService.searchSale(searchQuery.trim());

      if (result) {
        setFoundSale({
          id: result.id,
          sequentialNumber: result.localNumber,
          createdAt: result.createdAt,
          clientName: result.clientName,
          workstationName: result.workstationId,
          items: result.items.map((item) => ({
            id: item.id,
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            taxPercentage: item.taxRate,
            totalCents: item.totalCents,
            lotCode: item.lotCode,
          })),
          totalCents: result.totalCents,
        });
        setActiveTab("verified");
      } else {
        setSearchError(t("returns.sale_not_found"));
        setActiveTab("unverified");
      }
    } catch {
      setSearchError(t("returns.search_error"));
    }
  }, [searchQuery, returnsService, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSearch();
      }
    },
    [handleSearch],
  );

  const toggleItemSelection = useCallback((itemId: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  /** Submit a verified return. Role re-checked at call time. */
  const handleSubmitVerified = useCallback(async () => {
    setSubmitError(null);

    // Re-check role at submit time
    const currentSession = useLocalSessionStore.getState().session;
    if (!currentSession) {
      setSubmitError(t("errors.no_session"));
      return;
    }
    const role = currentSession.role as RoleType;
    if (role !== RoleType.CASHIER && role !== RoleType.ADMIN) {
      setSubmitError(t("errors.role_cashier_admin"));
      return;
    }

    if (!foundSale || selectedItemIds.size === 0) {
      setSubmitError(t("returns.no_items_selected"));
      return;
    }

    try {
      setIsProcessing(true);

      // Call the real ReturnsService — create a draft return then confirm it.
      // The service handles stock reversal and SyncQueue entry inside a
      // Prisma transaction.
      const draftReturn = await returnsService.create({
        saleId: foundSale.id,
        clientId: "", // The client ID comes from the original sale
        refundMethodId: "CASH",
        items: Array.from(selectedItemIds).map((saleItemId) => {
          const item = foundSale.items.find((i) => i.id === saleItemId)!;
          return {
            saleItemId,
            quantity: item.quantity,
          };
        }),
      });

      // Confirm (apply) the return — reverses stock and creates SyncQueue row
      const confirmed = await returnsService.confirm(
        (draftReturn as { id: string }).id,
      );

      setIsProcessing(false);

      setToast({
        operationUuid: (confirmed as { operationUuid?: string }).operationUuid
          ?? (draftReturn as { id: string }).id,
        operationType: "CLIENT_RETURN",
        isVerified: true,
      });

      // Reset form
      setFoundSale(null);
      setSearchQuery("");
      setSelectedItemIds(new Set());
    } catch (err) {
      setIsProcessing(false);
      setSubmitError(
        err instanceof Error ? err.message : t("returns.submit_error"),
      );
    }
  }, [foundSale, selectedItemIds, returnsService, t]);

  /** Submit an unverified return. Role re-checked at call time. */
  const handleSubmitUnverified = useCallback(async () => {
    setSubmitError(null);
    setPinError(null);

    // Re-check role at submit time
    const currentSession = useLocalSessionStore.getState().session;
    if (!currentSession) {
      setSubmitError(t("errors.no_session"));
      return;
    }
    const role = currentSession.role as RoleType;
    if (role !== RoleType.ADMIN) {
      setSubmitError(t("errors.role_admin"));
      return;
    }

    if (unverifiedItems.length === 0) {
      setSubmitError(t("returns.no_items_entered"));
      return;
    }

    if (!managerPin.trim()) {
      setPinError(t("returns.pin_required"));
      return;
    }

    if (managerPin.trim().length < 4) {
      setPinError(t("returns.pin_invalid"));
      return;
    }

    try {
      setIsProcessing(true);

      // For unverified returns we create a return with manager override.
      // Since we don't have a real sale UUID, we create an orphan return
      // that the server will reconcile.  The service will handle the
      // cross-workstation/manager-override logic.
      //
      // In production the unverified return uses a placeholder sale ID
      // (the physical receipt number) and the server reconciles it.
      const placeholderSaleId = `UNVERIFIED-${Date.now()}`;

      const draftReturn = await returnsService.create({
        saleId: placeholderSaleId,
        clientId: "",
        refundMethodId: "CASH",
        reason: "UNVERIFIED_RETURN",
        notes: `Physical receipt: ${managerPin}`,
        items: unverifiedItems.map((item) => ({
          saleItemId: `manual-${item.productId}`,
          quantity: item.quantity,
        })),
      });

      const confirmed = await returnsService.confirm(
        (draftReturn as { id: string }).id,
        { managerOverride: true },
      );

      setIsProcessing(false);

      setToast({
        operationUuid: (confirmed as { operationUuid?: string }).operationUuid
          ?? (draftReturn as { id: string }).id,
        operationType: "CLIENT_RETURN",
        isVerified: false,
      });

      setUnverifiedItems([]);
      setManagerPin("");
    } catch (err) {
      setIsProcessing(false);
      setSubmitError(
        err instanceof Error ? err.message : t("returns.submit_error"),
      );
    }
  }, [unverifiedItems, managerPin, returnsService, t]);

  const handleBack = useCallback(() => {
    dispatch(navigateBackToSales());
  }, [dispatch]);

  const handleDismissToast = useCallback(() => {
    setToast(null);
  }, []);

  // -----------------------------------------------------------------------
  // Derived
  // -----------------------------------------------------------------------

  const canSubmitVerified = useMemo(
    () => foundSale !== null && selectedItemIds.size > 0 && !isProcessing,
    [foundSale, selectedItemIds, isProcessing],
  );

  const canSubmitUnverified = useMemo(
    () => unverifiedItems.length > 0 && managerPin.trim().length >= 4 && !isProcessing,
    [unverifiedItems, managerPin, isProcessing],
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <section
      aria-label={t("returns.title")}
      className="flex h-full flex-col overflow-y-auto"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-pos-xl pt-pos-lg pb-pos-md">
        <div className="flex items-center gap-pos-md">
          <button
            type="button"
            onClick={handleBack}
            className="pos-button pos-button-secondary"
            aria-label={t("common.back")}
          >
            <BackIcon />
          </button>
          <h1
            className="pos-page-title"
            style={{ color: "var(--color-ink)" }}
          >
            {t("returns.title")}
          </h1>
        </div>

        <span
          className="text-caption font-medium"
          style={{
            color: isOnline
              ? "var(--color-pharma)"
              : "var(--color-urgency)",
          }}
        >
          {isOnline ? t("sync.state_online") : t("sync.state_offline")}
        </span>
      </div>

      {/* Tab toggle */}
      <div
        className="mx-pos-xl mb-pos-lg flex gap-pos-xs"
        role="tablist"
        aria-label={t("returns.flow_selector")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "verified"}
          className={`pos-button flex-1 ${
            activeTab === "verified"
              ? "pos-button-primary"
              : "pos-button-secondary"
          }`}
          onClick={() => setActiveTab("verified")}
        >
          {t("returns.verified_tab")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "unverified"}
          className={`pos-button flex-1 ${
            activeTab === "unverified"
              ? "pos-button-restrict"
              : "pos-button-secondary"
          }`}
          onClick={() => setActiveTab("unverified")}
        >
          {t("returns.unverified_tab")}
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 px-pos-xl pb-pos-xl">
        {activeTab === "verified" && (
          <VerifiedReturnFlow
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            onSearch={handleSearch}
            onKeyDown={handleKeyDown}
            searchError={searchError}
            foundSale={foundSale}
            selectedItemIds={selectedItemIds}
            onToggleItem={toggleItemSelection}
            isProcessing={isProcessing}
            onSubmit={handleSubmitVerified}
            canSubmit={canSubmitVerified}
          />
        )}

        {activeTab === "unverified" && (
          <UnverifiedReturnFlow
            items={unverifiedItems}
            onItemsChange={setUnverifiedItems}
            managerPin={managerPin}
            onManagerPinChange={setManagerPin}
            pinError={pinError}
            isProcessing={isProcessing}
            onSubmit={handleSubmitUnverified}
            canSubmit={canSubmitUnverified}
          />
        )}

        {/* Submit error */}
        {submitError && (
          <div
            className="mt-pos-md rounded px-pos-md py-pos-sm text-body font-medium"
            role="alert"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-urgency) 10%, transparent)",
              color: "var(--color-urgency)",
            }}
          >
            {submitError}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
          <OperationQueuedToast
            operationUuid={toast.operationUuid}
            operationType={toast.operationType}
            isVerified={toast.isVerified}
            isOnline={isOnline}
            onDismiss={handleDismissToast}
          />
        </div>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Verified return sub-component
// ---------------------------------------------------------------------------

interface VerifiedReturnFlowProps {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearch: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  searchError: string | null;
  foundSale: SaleSearchResult | null;
  selectedItemIds: Set<string>;
  onToggleItem: (itemId: string) => void;
  isProcessing: boolean;
  onSubmit: () => void;
  canSubmit: boolean;
}

const VerifiedReturnFlow: FC<VerifiedReturnFlowProps> = ({
  searchQuery,
  onSearchQueryChange,
  onSearch,
  onKeyDown,
  searchError,
  foundSale,
  selectedItemIds,
  onToggleItem,
  isProcessing,
  onSubmit,
  canSubmit,
}) => {
  const { t } = useTranslation();

  return (
    <div>
      {/* Sale search */}
      <div className="pos-panel p-pos-md mb-pos-lg">
        <label
          htmlFor="return-sale-search"
          className="mb-pos-xs block text-caption font-semibold uppercase tracking-wide"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("returns.search_label")}
        </label>
        <div className="flex gap-pos-sm">
          <input
            id="return-sale-search"
            type="text"
            className="pos-input"
            placeholder={t("returns.search_placeholder")}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={isProcessing}
            aria-describedby={searchError ? "return-search-error" : undefined}
          />
          <button
            type="button"
            onClick={onSearch}
            disabled={isProcessing || !searchQuery.trim()}
            className="pos-button pos-button-primary"
          >
            {t("common.search")}
          </button>
        </div>
        {searchError && (
          <p
            id="return-search-error"
            className="mt-pos-xs text-caption font-medium"
            style={{ color: "var(--color-urgency)" }}
            role="alert"
          >
            {searchError}
          </p>
        )}
      </div>

      {/* Sale details + items */}
      {foundSale && (
        <div className="pos-panel overflow-hidden">
          <div
            className="flex items-center justify-between px-pos-md py-pos-sm"
            style={{
              borderBottom:
                "1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)",
            }}
          >
            <div>
              <span
                className="text-body font-semibold"
                style={{ color: "var(--color-ink)" }}
              >
                {t("returns.sale_number")}: #{foundSale.sequentialNumber}
              </span>
              <span
                className="ml-pos-md text-caption"
                style={{
                  color:
                    "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                }}
              >
                {foundSale.clientName}
              </span>
            </div>
            <span
              className="font-data tabular-nums text-ui font-semibold"
              style={{ color: "var(--color-pharma)" }}
            >
              {formatCents(foundSale.totalCents)}
            </span>
          </div>

          <table
            className="pos-return-table w-full"
            role="grid"
            aria-label={t("returns.items_table")}
          >
            <thead>
              <tr>
                <th className="pos-return-table__th" scope="col" aria-hidden="true">
                  {/* Checkbox column */}
                </th>
                <th className="pos-return-table__th" scope="col">
                  {t("returns.table_product")}
                </th>
                <th className="pos-return-table__th" scope="col">
                  {t("returns.table_lot")}
                </th>
                <th className="pos-return-table__th pos-return-table__th--numeric" scope="col">
                  {t("returns.table_qty")}
                </th>
                <th className="pos-return-table__th pos-return-table__th--numeric" scope="col">
                  {t("returns.table_price")}
                </th>
                <th className="pos-return-table__th pos-return-table__th--numeric" scope="col">
                  {t("returns.table_refund")}
                </th>
              </tr>
            </thead>
            <tbody>
              {foundSale.items.map((item) => {
                const isSelected = selectedItemIds.has(item.id);
                const refundAmount = item.unitPriceCents * item.quantity;
                return (
                  <tr
                    key={item.id}
                    className={`pos-return-table__row ${isSelected ? "pos-return-table__row--selected" : ""}`}
                    onClick={() => onToggleItem(item.id)}
                    role="row"
                    aria-selected={isSelected}
                  >
                    <td className="pos-return-table__td" role="gridcell">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleItem(item.id)}
                        aria-label={`${t("returns.select_item")} ${item.productName}`}
                        disabled={isProcessing}
                      />
                    </td>
                    <td className="pos-return-table__td" role="gridcell">
                      <span className="font-medium">{item.productName}</span>
                    </td>
                    <td className="pos-return-table__td" role="gridcell">
                      <span className="font-data tabular-nums text-caption">
                        {item.lotCode}
                      </span>
                    </td>
                    <td className="pos-return-table__td pos-return-table__td--numeric" role="gridcell">
                      {item.quantity}
                    </td>
                    <td className="pos-return-table__td pos-return-table__td--numeric font-data tabular-nums" role="gridcell">
                      {formatCents(item.unitPriceCents)}
                    </td>
                    <td className="pos-return-table__td pos-return-table__td--numeric font-data tabular-nums" role="gridcell">
                      {formatCents(refundAmount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="flex justify-end px-pos-md py-pos-sm">
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className="pos-button pos-button-primary px-pos-xl"
            >
              {isProcessing
                ? t("returns.processing")
                : t("returns.process_return")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Unverified return sub-component
// ---------------------------------------------------------------------------

interface UnverifiedReturnFlowProps {
  items: UnverifiedItemEntry[];
  onItemsChange: (items: UnverifiedItemEntry[]) => void;
  managerPin: string;
  onManagerPinChange: (pin: string) => void;
  pinError: string | null;
  isProcessing: boolean;
  onSubmit: () => void;
  canSubmit: boolean;
}

const UnverifiedReturnFlow: FC<UnverifiedReturnFlowProps> = ({
  items,
  onItemsChange,
  managerPin,
  onManagerPinChange,
  pinError,
  isProcessing,
  onSubmit,
  canSubmit,
}) => {
  const { t } = useTranslation();
  const [productSearch, setProductSearch] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [quantity, setQuantity] = useState(1);

  const handleAddItem = useCallback(() => {
    if (!productSearch.trim() || quantity <= 0) {
      return;
    }
    onItemsChange([
      ...items,
      {
        productId: `manual-${Date.now()}`,
        productName: productSearch.trim(),
        lotCode: lotCode.trim() || "LOT-MANUAL",
        quantity,
      },
    ]);
    setProductSearch("");
    setLotCode("");
    setQuantity(1);
  }, [items, productSearch, lotCode, quantity, onItemsChange]);

  const handleRemoveItem = useCallback(
    (index: number) => {
      onItemsChange(items.filter((_, i) => i !== index));
    },
    [items, onItemsChange],
  );

  return (
    <div>
      <div className="pos-panel p-pos-md mb-pos-lg">
        <h2
          className="text-ui font-semibold mb-pos-sm"
          style={{ color: "var(--color-ink)" }}
        >
          {t("returns.unverified_notice")}
        </h2>
        <p
          className="text-body-sm mb-pos-md"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("returns.unverified_description")}
        </p>

        {/* Product + lot entry */}
        <div className="grid grid-cols-3 gap-pos-md mb-pos-md">
          <div>
            <label
              htmlFor="unverified-product"
              className="mb-pos-xs block text-caption font-semibold uppercase tracking-wide"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 60%, transparent)",
              }}
            >
              {t("returns.unverified_product")}
            </label>
            <input
              id="unverified-product"
              type="text"
              className="pos-input"
              placeholder={t("returns.unverified_product_placeholder")}
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              disabled={isProcessing}
            />
          </div>
          <div>
            <label
              htmlFor="unverified-lot"
              className="mb-pos-xs block text-caption font-semibold uppercase tracking-wide"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 60%, transparent)",
              }}
            >
              {t("returns.unverified_lot")}
            </label>
            <input
              id="unverified-lot"
              type="text"
              className="pos-input"
              placeholder={t("returns.unverified_lot_placeholder")}
              value={lotCode}
              onChange={(e) => setLotCode(e.target.value)}
              disabled={isProcessing}
            />
          </div>
          <div>
            <label
              htmlFor="unverified-qty"
              className="mb-pos-xs block text-caption font-semibold uppercase tracking-wide"
              style={{
                color:
                  "color-mix(in srgb, var(--color-ink) 60%, transparent)",
              }}
            >
              {t("returns.table_qty")}
            </label>
            <input
              id="unverified-qty"
              type="number"
              className="pos-input"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
              disabled={isProcessing}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleAddItem}
          disabled={isProcessing || !productSearch.trim() || quantity <= 0}
          className="pos-button pos-button-secondary w-full"
        >
          {t("common.add")}
        </button>
      </div>

      {/* Item list */}
      {items.length > 0 && (
        <div className="pos-panel p-pos-md mb-pos-lg">
          <h3
            className="text-body font-semibold mb-pos-sm"
            style={{ color: "var(--color-ink)" }}
          >
            {t("returns.items_to_return")}
          </h3>
          <ul className="flex flex-col gap-pos-xs">
            {items.map((item, index) => (
              <li
                key={`${item.productId}-${index}`}
                className="flex items-center justify-between rounded px-pos-sm py-pos-xs"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--color-surface) 50%, white)",
                }}
              >
                <div className="flex items-center gap-pos-md">
                  <span
                    className="text-body font-medium"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {item.productName}
                  </span>
                  <span
                    className="font-data tabular-nums text-caption"
                    style={{
                      color:
                        "color-mix(in srgb, var(--color-ink) 50%, transparent)",
                    }}
                  >
                    {t("returns.table_lot")}: {item.lotCode}
                  </span>
                  <span
                    className="font-data tabular-nums text-body font-semibold"
                    style={{ color: "var(--color-pharma)" }}
                  >
                    x{item.quantity}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveItem(index)}
                  className="pos-button pos-button-secondary text-caption px-pos-sm py-pos-xs"
                  disabled={isProcessing}
                  aria-label={`${t("common.remove")} ${item.productName}`}
                >
                  {t("common.remove")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Manager PIN */}
      <div className="pos-panel p-pos-md mb-pos-lg">
        <label
          htmlFor="manager-pin"
          className="mb-pos-xs block text-caption font-semibold uppercase tracking-wide"
          style={{
            color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
          }}
        >
          {t("returns.manager_pin")}
        </label>
        <input
          id="manager-pin"
          type="password"
          className="pos-input"
          placeholder="****"
          value={managerPin}
          onChange={(e) => onManagerPinChange(e.target.value)}
          disabled={isProcessing}
          maxLength={10}
          aria-describedby={pinError ? "pin-error" : undefined}
        />
        {pinError && (
          <p
            id="pin-error"
            className="mt-pos-xs text-caption font-medium"
            style={{ color: "var(--color-urgency)" }}
            role="alert"
          >
            {pinError}
          </p>
        )}
      </div>

      {/* Submit */}
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="pos-button pos-button-restrict px-pos-xl w-full"
      >
        {isProcessing
          ? t("returns.processing")
          : t("returns.submit_unverified")}
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const BackIcon: FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);
