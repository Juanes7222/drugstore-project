/**
 * Returns page — thin wiring container.
 *
 * Owns all state, validation, and submission orchestration for the client
 * return processing screen.  Presentational sub-components are imported from
 * sibling files so this file stays focused on wiring, not markup.
 *
 * Two flows:
 *   1. Verified return (default): search by local sale number / UUID, display
 *      sale items, and process the return. Requires CASHIER or ADMIN role.
 *   2. Unverified return (fallback): when the sale is not found locally, the
 *      cashier manually enters items, lots, and quantities. Requires ADMIN
 *      role (manager override) and a PIN confirmation on submit.
 *
 * Role re-check happens on submit, not just on mount, to guard against
 * session changes while the form is being filled.
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
import { RoleType } from "@pharmacy/shared-types";
import { useReturnsService } from "../common/service-context";
import type { SaleSearchResult, UnverifiedItemEntry, ReturnTab } from "./returns.types";

// ── Presentational components (provided by frontend-pos) ────────────────
import { ReturnsHeader } from "./returns-header";
import { ReturnTabs } from "./return-tabs";
import { VerifiedReturnFlow } from "./verified-return-flow";
import { UnverifiedReturnFlow } from "./unverified-return-flow";
import { ReturnsToast } from "./returns-toast";

// ── Page component ──────────────────────────────────────────────────────

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

  // ── Handlers ─────────────────────────────────────────────────────────

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
        void handleSearch();
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

      const draftReturn = await returnsService.create({
        saleId: foundSale.id,
        clientId: "",
        refundMethodId: "CASH",
        items: Array.from(selectedItemIds).map((saleItemId) => {
          const item = foundSale.items.find((i) => i.id === saleItemId)!;
          return {
            saleItemId,
            quantity: item.quantity,
          };
        }),
      });

      const confirmed = await returnsService.confirm(
        (draftReturn as { id: string }).id,
      );

      setIsProcessing(false);

      setToast({
        operationUuid:
          (confirmed as { operationUuid?: string }).operationUuid ??
          (draftReturn as { id: string }).id,
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
        operationUuid:
          (confirmed as { operationUuid?: string }).operationUuid ??
          (draftReturn as { id: string }).id,
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

  // ── Derived ─────────────────────────────────────────────────────────

  const canSubmitVerified = useMemo(
    () => foundSale !== null && selectedItemIds.size > 0 && !isProcessing,
    [foundSale, selectedItemIds, isProcessing],
  );

  const canSubmitUnverified = useMemo(
    () =>
      unverifiedItems.length > 0 &&
      managerPin.trim().length >= 4 &&
      !isProcessing,
    [unverifiedItems, managerPin, isProcessing],
  );

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <section
      aria-label={t("returns.title")}
      className="flex h-full flex-col overflow-y-auto"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      <ReturnsHeader
        isOnline={isOnline}
        onBack={handleBack}
      />

      <ReturnTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

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

        {submitError && <div
          className="mt-pos-md rounded px-pos-md py-pos-sm text-body font-medium"
          role="alert"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-urgency) 10%, transparent)",
            color: "var(--color-urgency)",
          }}
        >
          {submitError}
        </div>}
      </div>

      {toast && (
        <ReturnsToast
          operationUuid={toast.operationUuid}
          operationType={toast.operationType}
          isVerified={toast.isVerified}
          isOnline={isOnline}
          onDismiss={handleDismissToast}
        />
      )}
    </section>
  );
};
