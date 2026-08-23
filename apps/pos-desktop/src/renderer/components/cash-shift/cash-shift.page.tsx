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
import { useCompanySetup } from "@/hooks/use-company-setup";
import { useAppDispatch } from "@/store/hooks";
import { setActiveScreen } from "@/store/slices/ui-slice";
import { CompanySetupGate } from "../company-setup/company-setup-gate";
import {
  ShiftAlreadyOpenException,
  ShiftNotOpenException,
  MissingClosingCashCountsException,
} from "../../../domain/cash-shift/exceptions";
import type {
  CashShiftRecord,
  ShiftFiscalComparison,
} from "../../../domain/cash-shift/cash-shift.service";
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
  const dispatch = useAppDispatch();
  const cashShiftService = useCashShiftService();
  const { status: companySetupStatus } = useCompanySetup();

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

  // ---- Fiscal vs operational drift comparison ----
  const [driftComparison, setDriftComparison] =
    useState<ShiftFiscalComparison | null>(null);

  // ---- History state ----
  const [history, setHistory] = useState<CashShiftRecord[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  // Bumped on every first-page reset; a load-more append from a previous
  // generation must be discarded (see handleLoadMore).
  const historyGenerationRef = useRef(0);

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

  // ---- Load fiscal/operational drift for the active shift ----
  useEffect(() => {
    let cancelled = false;
    // Reset up-front so a stale comparison from a previously active shift
    // can never be reused by handleStartClose while the new one loads.
    setDriftComparison(null);
    if (!currentShift) return;
    cashShiftService
      .getShiftFiscalComparison(currentShift.id)
      .then((comparison) => {
        if (!cancelled) setDriftComparison(comparison);
      })
      .catch(() => {
        // Silent fail — the banner stays hidden on error.
        if (!cancelled) setDriftComparison(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cashShiftService, currentShift?.id]);

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

  // ---- Fetch history (first page, replaces the list) ----
  const fetchFirstPage = useCallback(async () => {
    historyGenerationRef.current += 1;
    setHistoryLoading(true);
    try {
      const result = await cashShiftService.getShiftHistory({
        limit: HISTORY_PAGE_SIZE,
      });
      setHistory(result.shifts);
      setHistoryTotal(result.total);
    } catch {
      // Silent fail
    } finally {
      setHistoryLoading(false);
    }
  }, [cashShiftService]);

  useEffect(() => {
    void fetchFirstPage();
  }, [fetchFirstPage, currentShift?.id]);

  // ---- Load more (keyset cursor append) ----
  const handleLoadMore = useCallback(async () => {
    const last = history[history.length - 1];
    if (!last || historyLoadingMore) return;
    const generation = historyGenerationRef.current;
    setHistoryLoadingMore(true);
    try {
      const result = await cashShiftService.getShiftHistory({
        limit: HISTORY_PAGE_SIZE,
        cursor: { id: last.id },
      });
      // Discard the append if the list was reset (e.g. a shift was opened)
      // while this request was in flight.
      if (historyGenerationRef.current !== generation) return;
      setHistory((prev) => {
        // A shift may have been opened/closed between pages — dedupe by id
        // so the accumulated list never shows the same shift twice.
        const known = new Set(prev.map((s) => s.id));
        return [...prev, ...result.shifts.filter((s) => !known.has(s.id))];
      });
      setHistoryTotal(result.total);
    } catch {
      // Silent fail
    } finally {
      setHistoryLoadingMore(false);
    }
  }, [cashShiftService, history, historyLoadingMore]);

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
      // The drift comparison already computed the operational totals for
      // this shift — reuse them so the wizard does not re-run the
      // expensive operational-view resolution.
      const summary = await cashShiftService.getShiftSalesSummary(
        currentShift.id,
        driftComparison
          ? new Map(
              driftComparison.totals.map((t) => [
                t.paymentMethodId,
                new Prisma.Decimal(t.operationalAmount),
              ]),
            )
          : undefined,
      );
      setCloseWizard({ step: "summary", data: summary });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : t("common.unexpected_error"),
      );
      setCloseWizard({ step: "idle" });
    }
  }, [currentShift, cashShiftService, driftComparison, t]);

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
      if (err instanceof ShiftNotOpenException) {
        // Double-submit guard: another close already closed this shift
        // (the second request waited on the PGlite write lock and then saw
        // the shift as CLOSED). The shift is closed either way — surface
        // success instead of an error.
        useCashShiftStore.getState().setCurrentShift(null);
        setCloseWizard({ step: "done" });
      } else if (err instanceof MissingClosingCashCountsException) {
        setActionError(t("cash_shift.errors.missing_closing_counts"));
        setCloseWizard({ step: "idle" });
      } else {
        setActionError(
          err instanceof Error ? err.message : t("common.unexpected_error"),
        );
        setCloseWizard({ step: "idle" });
      }
    }
  }, [closeWizard, cashShiftService, currentShift, t]);

  const handleWizardCancel = useCallback(() => {
    setCloseWizard({ step: "idle" });
    requiresStepUpRef.current = false;
  }, []);

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

  // ---- Company-setup gate ----
  // No electronic invoice can be issued without the fiscal emitter
  // profile, so opening a cash shift is blocked until it exists.
  if (companySetupStatus === "needs-setup") {
    return (
      <CompanySetupGate
        onConfigure={() => dispatch(setActiveScreen("company-setup"))}
      />
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
                drift={driftComparison}
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
        historyLoading={historyLoading}
        loadingMore={historyLoadingMore}
        hasMore={history.length < historyTotal}
        onLoadMore={() => void handleLoadMore()}
      />
    </div>
  );
};
