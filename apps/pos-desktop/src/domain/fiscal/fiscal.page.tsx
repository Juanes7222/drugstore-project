/**
 * Manager/Admin fiscal management page.
 *
 * Thin wiring container: owns UI state, action handlers, and composition.
 * Domain services initialized via useFiscalServices hook.
 * Presentational components imported from renderer/components/fiscal/.
 *
 * Shows:
 * - Invoice list with filtering
 * - Dual-panel invoice detail (fiscal + operational)
 * - Adjustment history and management
 * - Contingency event history
 *
 * Role-gated to ADMIN.
 *
 * @category Page
 */

import { type FC, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSessionStore } from "../auth/local-session.store";
import { useContingencyStore } from "./contingency.store";
import { useFiscalServices } from "./use-fiscal-services";
import type { InvoiceModel } from "./fiscal-types";
import type {
  OperationalInvoiceView,
  AdjustmentType,
  AdjustmentHistoryEntry,
} from "./local-adjustment.types";
import { RoleType } from "@pharmacy/shared-types";

// Presentational components
import { InvoiceListView } from "../../renderer/components/fiscal/invoice-list-view";
import { ContingencyHistoryView } from "../../renderer/components/fiscal/contingency-history-view";
import { FiscalInvoiceDetailPanel } from "../../renderer/components/fiscal/fiscal-invoice-detail-panel";
import { OperationalInvoiceDetailPanel } from "../../renderer/components/fiscal/operational-invoice-detail-panel";
import { AdjustmentHistoryPanel } from "../../renderer/components/fiscal/adjustment-history-panel";
import { AdjustmentCreationModal } from "../../renderer/components/fiscal/adjustment-creation-modal";
import { FiscalHeader } from "../../renderer/components/fiscal/fiscal-header";

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export const FiscalPage: FC = () => {
  const { t } = useTranslation();
  const session = useLocalSessionStore((s) => s.session);
  const contingencyState = useContingencyStore.getState();
  const { loading, error, invoices, totalCount, history, loadData, servicesRef } =
    useFiscalServices();

  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceModel | null>(null);
  const [tab, setTab] = useState<"invoices" | "contingency">("invoices");

  // Operational view state
  const [operationalView, setOperationalView] = useState<OperationalInvoiceView | null>(null);
  const [adjustmentHistory, setAdjustmentHistory] = useState<AdjustmentHistoryEntry[]>([]);
  const [operationalLoading, setOperationalLoading] = useState(false);

  // Detail panel sub-tab
  const [detailView, setDetailView] = useState<"fiscal" | "dual">("fiscal");

  // Adjustment creation modal state
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [adjustmentModalLoading, setAdjustmentModalLoading] = useState(false);
  const [adjustmentModalError, setAdjustmentModalError] = useState<string | null>(null);
  const [allowedAdjustmentTypes, setAllowedAdjustmentTypes] = useState<AdjustmentType[]>([]);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  const handleSelectInvoice = useCallback(async (invoice: InvoiceModel) => {
    setSelectedInvoice(invoice);
    setDetailView("fiscal");

    const adjSvc = servicesRef.current.adjustmentService;
    if (!adjSvc) return;

    setOperationalLoading(true);
    try {
      const [opView, adjHist] = await Promise.all([
        adjSvc.resolveOperationalView(invoice.id),
        adjSvc.getAdjustmentHistory(invoice.id),
      ]);
      setOperationalView(opView);
      setAdjustmentHistory(adjHist);
    } catch {
      setOperationalView(null);
      setAdjustmentHistory([]);
    } finally {
      setOperationalLoading(false);
    }
  }, [servicesRef]);

  const handleCloseDetail = useCallback(() => {
    setSelectedInvoice(null);
    setOperationalView(null);
    setAdjustmentHistory([]);
  }, []);

  const handleReprint = useCallback(async () => {
    if (!selectedInvoice) return;
    try {
      const { generateReceiptHtml, printReceipt } = await import("./receipt-generator");
      const html = generateReceiptHtml(selectedInvoice);
      printReceipt(html);
    } catch {
      // Silent — error handled by the component internally
    }
  }, [selectedInvoice]);

  const handleCancel = useCallback(async () => {
    if (!selectedInvoice || !servicesRef.current.invoiceService) return;
    try {
      await servicesRef.current.invoiceService.cancelInvoice(
        selectedInvoice.id,
        t("fiscal.cancel_reason"),
      );
      setSelectedInvoice(null);
      await loadData();
    } catch {
      // Silent — panel displays error via actionMessage prop
    }
  }, [selectedInvoice, loadData, t, servicesRef]);

  const handleExportCsv = useCallback(async () => {
    const adjSvc = servicesRef.current.adjustmentService;
    if (!adjSvc || !selectedInvoice) return;
    try {
      const csv = await adjSvc.exportAdjustmentLogAsCsv(selectedInvoice.id);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${t("fiscal.csv_prefix")}-${selectedInvoice.invoiceNumber}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // swallow
    }
  }, [selectedInvoice, servicesRef]);

  const handleOpenAdjustmentModal = useCallback(async () => {
    if (!selectedInvoice || !servicesRef.current.adjustmentService) return;
    try {
      const types = await servicesRef.current.adjustmentService.getAllowableAdjustmentTypes(
        selectedInvoice.id,
      );
      setAllowedAdjustmentTypes(types);
      setAdjustmentModalError(null);
      setShowAdjustmentModal(true);
    } catch {
      setAdjustmentModalError(t("fiscal.adjustment_create_load_types_error"));
      setShowAdjustmentModal(true);
    }
  }, [selectedInvoice, servicesRef]);

  const handleCloseAdjustmentModal = useCallback(() => {
    setShowAdjustmentModal(false);
    setAdjustmentModalError(null);
    setAdjustmentModalLoading(false);
  }, []);

  const handleApplyAdjustment = useCallback(
    async (type: AdjustmentType, newValue: unknown, reason: string) => {
      if (!selectedInvoice || !servicesRef.current.adjustmentService) return;
      setAdjustmentModalLoading(true);
      setAdjustmentModalError(null);
      try {
        await servicesRef.current.adjustmentService.applyAdjustment(
          selectedInvoice.id,
          type,
          newValue,
          reason,
        );
        const adjSvc = servicesRef.current.adjustmentService;
        if (adjSvc) {
          const [opView, adjHist] = await Promise.all([
            adjSvc.resolveOperationalView(selectedInvoice.id),
            adjSvc.getAdjustmentHistory(selectedInvoice.id),
          ]);
          setOperationalView(opView);
          setAdjustmentHistory(adjHist);
          if (opView.operational.hasDifferences) {
            setDetailView("dual");
          }
        }
        setShowAdjustmentModal(false);
      } catch (err) {
        setAdjustmentModalError(
          err instanceof Error ? err.message : t("fiscal.adjustment_create_apply_error"),
        );
      } finally {
        setAdjustmentModalLoading(false);
      }
    },
    [selectedInvoice, servicesRef],
  );

  // ------------------------------------------------------------------
  // Role gate
  // ------------------------------------------------------------------

  const role = session?.role as RoleType | undefined;
  const hasAccess = role === RoleType.ADMIN || role === RoleType.OWNER;

  if (!hasAccess) {
    return (
      <section className="flex h-full items-center justify-center p-pos-xl">
        <div className="rounded-lg border border-danger/20 bg-error-container p-pos-xl text-center">
          <h2 className="text-ui font-bold text-danger">{t("fiscal.access_denied_title")}</h2>
          <p className="mt-pos-sm text-danger/80">{t("fiscal.access_denied_message")}</p>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="flex h-full items-center justify-center p-pos-xl">
        <div className="text-center">
          <div className="mx-auto mb-pos-md h-8 w-8 animate-spin rounded-full border-2 border-t-pharma border-r-pharma border-transparent" />
          <p className="text-body text-ink-muted">{t("fiscal.loading")}</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="flex h-full items-center justify-center p-pos-xl">
        <div className="rounded-lg border border-danger/30 bg-error-container p-pos-xl text-center">
          <h2 className="text-ui font-bold text-danger">{t("fiscal.error_title")}</h2>
          <p className="mt-pos-sm text-danger/80">{error}</p>
          <button
            type="button"
            className="mt-pos-md rounded bg-danger px-pos-md py-pos-sm text-white hover:opacity-90"
            onClick={loadData}
          >
            {t("fiscal.retry")}
          </button>
        </div>
      </section>
    );
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const isPending = selectedInvoice?.status === "CONTINGENCY_PENDING_TRANSMISSION";
  const isCancellable = !!(
    selectedInvoice &&
    (isPending || selectedInvoice.status === "TRANSMITTED_AUTHORIZED")
  );

  return (
    <section className="flex h-full flex-col overflow-hidden bg-surface">
      <FiscalHeader
        activeTab={tab}
        totalCount={totalCount}
        contingencyMode={contingencyState.active}
        onTabChange={setTab}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Main content area */}
        <div className={`flex-1 overflow-y-auto p-pos-xl ${selectedInvoice ? "pr-pos-sm" : ""}`}>
          {tab === "invoices" && (
            <InvoiceListView
              invoices={invoices}
              onSelect={handleSelectInvoice}
              onRefresh={loadData}
            />
          )}

          {tab === "contingency" && (
            <ContingencyHistoryView history={history} />
          )}
        </div>

        {/* Invoice detail side panel */}
        {selectedInvoice && (
          <aside
            className="flex flex-col overflow-hidden border-l border-ink/8 bg-panel"
            style={{ width: detailView === "dual" ? "48rem" : "24rem" }}
          >
            {/* Detail view toggle */}
            <div className="flex items-center justify-between border-b border-ink/8 px-pos-md py-pos-sm">
              <h2 className="text-body-sm font-semibold text-ink">{t("fiscal.invoice_detail")}</h2>
              <div className="flex items-center gap-pos-sm">
                <button
                  type="button"
                  className={`rounded px-pos-sm py-1 text-caption font-medium transition-colors ${
                    detailView === "fiscal"
                      ? "bg-pharma/10 text-pharma"
                      : "text-ink-muted hover:bg-ink/5"
                  }`}
                  onClick={() => setDetailView("fiscal")}
                >
                  {t("fiscal.view_fiscal")}
                </button>
                {operationalView && (
                  <button
                    type="button"
                    className={`rounded px-pos-sm py-1 text-caption font-medium transition-colors ${
                      detailView === "dual"
                        ? "bg-pharma/10 text-pharma"
                        : "text-ink-muted hover:bg-ink/5"
                    }`}
                    onClick={() => setDetailView("dual")}
                  >
                    {t("fiscal.view_dual")}
                  </button>
                )}
                <button
                  type="button"
                  className="text-ink-muted hover:text-ink transition-colors"
                  onClick={handleCloseDetail}
                  aria-label={t("common.close")}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* Fiscal panel (always visible) */}
              <div
                className={`overflow-y-auto ${detailView === "dual" ? "w-1/2 border-r border-ink/8" : "flex-1"}`}
              >
                <FiscalInvoiceDetailPanel
                  invoice={selectedInvoice}
                  onReprint={handleReprint}
                  onCancel={handleCancel}
                  isCancelling={false}
                  isCancellable={isCancellable}
                />
              </div>

              {/* Operational panel (visible in dual mode) */}
              {detailView === "dual" && operationalView && (
                <div className="flex w-1/2 flex-col overflow-y-auto">
                  <OperationalInvoiceDetailPanel
                    operationalView={operationalView}
                    adjustmentCount={adjustmentHistory.length}
                    isLoading={operationalLoading}
                    onCreateAdjustment={handleOpenAdjustmentModal}
                  />

                  {adjustmentHistory.length > 0 && (
                    <div className="border-t border-ink/8">
                      <AdjustmentHistoryPanel
                        adjustments={adjustmentHistory}
                        isLoading={operationalLoading}
                        onExportCsv={handleExportCsv}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Adjustment creation modal */}
      {selectedInvoice && (
        <AdjustmentCreationModal
          visible={showAdjustmentModal}
          invoiceId={selectedInvoice.id}
          invoiceStatus={selectedInvoice.status as string}
          operationalView={operationalView}
          allowedTypes={allowedAdjustmentTypes}
          loading={adjustmentModalLoading}
          error={adjustmentModalError}
          onSubmit={handleApplyAdjustment}
          onClose={handleCloseAdjustmentModal}
        />
      )}
    </section>
  );
};
