/**
 * Cash-shift management page.
 *
 * Thin wiring container:
 * 1. Subscribes to the reactive cash-shift store
 * 2. Orchestrates the close wizard state machine
 * 3. Delegates rendering to extracted presentational components
 * 4. Manages history fetching + pagination
 *
 * The close wizard follows a 3-step flow:
 *   1. Summary — sales totals per payment method (SummaryStep)
 *   2. Count   — declare actual amounts per payment method (CountStep)
 *   3. Review  — confirm differences, close (ConfirmStep)
 *
 * @category Page
 */

import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { Prisma } from "@pharmacy/database/local";
import { useCashShiftService } from "../common/service-context";
import { useCashShiftStore } from "../../../domain/cash-shift/cash-shift.store";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import {
  ShiftAlreadyOpenException,
  MissingClosingCashCountsException,
} from "../../../domain/cash-shift/exceptions";
import type { CashShiftRecord } from "../../../domain/cash-shift/cash-shift.service";
import { ActiveShiftView } from "./active-shift-view";
import { SummaryStep } from "./summary-step";
import { CountStep } from "./count-step";
import { ConfirmStep } from "./confirm-step";
import { OpenShiftForm } from "./open-shift-form";
import { ShiftHistorySection } from "./shift-history-section";
import type {
  PageState,
  CloseWizardStep,
  CountEntry,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HISTORY_PAGE_SIZE = 20;
const STEP_UP_THRESHOLD = 50_000;

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export const CashShiftPage: FC = () => {
  const { t } = useTranslation();
  const cashShiftService = useCashShiftService();

  // Reactive store subscription via useSyncExternalStore (vanilla zustand)
  const cashShiftState = useSyncExternalStore(
    useCashShiftStore.subscribe,
    () => useCashShiftStore.getState(),
  );
  const currentShift = cashShiftState.currentShift;
  const isLoading = cashShiftState.isLoading;

  // ---- Local UI state ----
  const [openingBalance, setOpeningBalance] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ---- Close wizard state ----
  const [closeWizard, setCloseWizard] = useState<CloseWizardStep>({ step: "idle" });
  const requiresStepUpRef = useRef(false);

  // ---- History state ----
  const [history, setHistory] = useState<CashShiftRecord[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ---- Derived page state ----
  const pageState: PageState = useMemo(() => {
    if (isLoading) return { status: "loading" };
    if (currentShift) return { status: "open" };
    return { status: "no-shift" };
  }, [isLoading, currentShift]);

  // ---- Clear transient errors when shift state changes ----
  useEffect(() => {
    setActionError(null);
  }, [currentShift?.id]);

  // ---- Re-hydrate on mount ----
  useEffect(() => {
    const session = useLocalSessionStore.getState().session;
    if (session?.workstationId && !currentShift && !isLoading) {
      cashShiftService.hydrateStore();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Reset wizard when shift changes ----
  useEffect(() => {
    setCloseWizard({ step: "idle" });
    requiresStepUpRef.current = false;
  }, [currentShift?.id]);

  // ---- Fetch history ----
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const result = await cashShiftService.getShiftHistory({
        limit: HISTORY_PAGE_SIZE,
        offset: historyOffset,
      });
      setHistory(result.shifts);
      setHistoryTotal(result.total);
    } catch {
      // Silent fail
    } finally {
      setHistoryLoading(false);
    }
  }, [cashShiftService, historyOffset]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory, currentShift?.id]);

  // ---- Handlers ----

  const handleOpenShift = useCallback(async () => {
    const balanceNum = Number(openingBalance);
    if (Number.isNaN(balanceNum) || balanceNum < 0) {
      setActionError(t("cash_shift.errors.invalid_balance"));
      return;
    }

    setIsSubmitting(true);
    setActionError(null);

    try {
      const shift = await cashShiftService.openShift({
        openingBalance: new Prisma.Decimal(balanceNum),
      });
      useCashShiftStore.getState().setCurrentShift(shift);
      setOpeningBalance("");
    } catch (err) {
      if (err instanceof ShiftAlreadyOpenException) {
        setActionError(t("cash_shift.errors.shift_already_open"));
      } else {
        setActionError(
          err instanceof Error ? err.message : t("common.unexpected_error"),
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [openingBalance, cashShiftService, t]);

  const handleStartClose = useCallback(async () => {
    if (!currentShift) return;
    setCloseWizard({
      step: "summary",
      data: { transactionCount: 0, totalSalesAmount: "0", totalsByPaymentMethod: [] },
    });
    try {
      const summary = await cashShiftService.getShiftSalesSummary(currentShift.id);
      setCloseWizard({ step: "summary", data: summary });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : t("common.unexpected_error"),
      );
      setCloseWizard({ step: "idle" });
    }
  }, [currentShift, cashShiftService, t]);

  const handleSummaryNext = useCallback(() => {
    const w = closeWizard;
    if (w.step !== "summary") return;
    setCloseWizard({ step: "count", data: w.data });
  }, [closeWizard]);

  const handleCountsSubmit = useCallback(
    (counts: CountEntry[]) => {
      const w = closeWizard;
      if (w.step !== "count") return;

      const hasLargeDiff = counts.some((c) => {
        const method = w.data.totalsByPaymentMethod.find(
          (m) => m.paymentMethodId === c.paymentMethodId,
        );
        if (!method || !method.isCash) return false;
        return Math.abs(c.declaredAmount - Number(method.expectedAmount)) >= STEP_UP_THRESHOLD;
      });
      requiresStepUpRef.current = hasLargeDiff;

      setCloseWizard({ step: "confirm", data: { summary: w.data, counts } });
    },
    [closeWizard],
  );

  const handleConfirmClose = useCallback(async () => {
    const w = closeWizard;
    if (w.step !== "confirm") return;

    setCloseWizard({ step: "closing" });
    setActionError(null);

    try {
      await cashShiftService.closeWithCounts(currentShift!.id, {
        counts: w.data.counts.map((c) => ({
          paymentMethodId: c.paymentMethodId,
          declaredAmount: new Prisma.Decimal(c.declaredAmount),
        })),
      });
      useCashShiftStore.getState().setCurrentShift(null);
      setCloseWizard({ step: "done" });
    } catch (err) {
      if (err instanceof MissingClosingCashCountsException) {
        setActionError(t("cash_shift.errors.missing_closing_counts"));
      } else {
        setActionError(
          err instanceof Error ? err.message : t("common.unexpected_error"),
        );
      }
      setCloseWizard({ step: "idle" });
    }
  }, [closeWizard, cashShiftService, currentShift, t]);

  const handleWizardCancel = useCallback(() => {
    setCloseWizard({ step: "idle" });
    requiresStepUpRef.current = false;
  }, []);

  const handlePrevPage = useCallback(() => {
    setHistoryOffset((prev) => Math.max(0, prev - HISTORY_PAGE_SIZE));
  }, []);

  const handleNextPage = useCallback(() => {
    setHistoryOffset((prev) =>
      Math.min(historyTotal - HISTORY_PAGE_SIZE, prev + HISTORY_PAGE_SIZE),
    );
  }, [historyTotal]);

  // ---- Loading state ----
  if (pageState.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-body-sm" style={{ color: "var(--color-ink-muted)" }}>
          {t("common.loading")}
        </p>
      </div>
    );
  }

  // ---- Render ----
  const session = useLocalSessionStore.getState().session;
  const cashierName = session?.fullName ?? "—";

  return (
    <div className="flex h-full flex-col gap-pos-xl overflow-y-auto p-pos-xl">
      <h1 className="pos-page-title">{t("cash_shift.label")}</h1>

      {/* Active shift / wizard section */}
      <section
        className="rounded-pos p-pos-xl"
        style={{
          backgroundColor: "var(--color-panel)",
          border:
            "1px solid color-mix(in srgb, var(--color-ink) 10%, transparent)",
        }}
      >
        <h2 className="mb-pos-lg text-body-lg font-semibold">
          {currentShift
            ? t("cash_shift.active_shift_title")
            : t("cash_shift.open_shift")}
        </h2>

        {currentShift ? (
          <>
            {closeWizard.step === "idle" && (
              <ActiveShiftView
                currentShift={currentShift}
                cashierName={cashierName}
                onStartClose={handleStartClose}
                actionError={actionError}
                isSubmitting={isSubmitting}
              />
            )}
            {closeWizard.step === "summary" && (
              <SummaryStep
                summary={closeWizard.data}
                onNext={handleSummaryNext}
                onCancel={handleWizardCancel}
              />
            )}
            {closeWizard.step === "count" && (
              <CountStep
                summary={closeWizard.data}
                onSubmit={handleCountsSubmit}
                onCancel={handleWizardCancel}
              />
            )}
            {closeWizard.step === "confirm" && (
              <ConfirmStep
                summary={closeWizard.data.summary}
                counts={closeWizard.data.counts}
                requiresStepUp={requiresStepUpRef.current}
                onConfirm={handleConfirmClose}
                onCancel={handleWizardCancel}
                actionError={actionError}
              />
            )}
            {closeWizard.step === "closing" && (
              <div className="flex items-center justify-center py-pos-xl">
                <p className="text-body-sm" style={{ color: "var(--color-ink-muted)" }}>
                  {t("cash_shift.close_in_progress")}
                </p>
              </div>
            )}
            {closeWizard.step === "done" && (
              <div className="flex flex-col items-center gap-pos-lg py-pos-xl">
                <p className="text-body-lg font-semibold" style={{ color: "var(--color-verified)" }}>
                  {t("cash_shift.close_success")}
                </p>
              </div>
            )}
          </>
        ) : (
          <OpenShiftForm
            openingBalance={openingBalance}
            onOpeningBalanceChange={setOpeningBalance}
            onSubmit={handleOpenShift}
            isSubmitting={isSubmitting}
            actionError={actionError}
          />
        )}
      </section>

      {/* Shift history section */}
      <ShiftHistorySection
        history={history}
        historyTotal={historyTotal}
        historyOffset={historyOffset}
        historyLoading={historyLoading}
        pageSize={HISTORY_PAGE_SIZE}
        onPrevPage={handlePrevPage}
        onNextPage={handleNextPage}
      />
    </div>
  );
};
