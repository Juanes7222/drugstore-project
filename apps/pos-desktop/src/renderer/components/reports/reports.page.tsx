/**
 * Reports page — sidebar + viewer.
 *
 * Thin wiring container:
 *  1. Reads the current session role to filter the catalog.
 *  2. Subscribes to the Zustand UI store for active report + filters.
 *  3. Delegates rendering to extracted presentational components.
 *  4. Calls the report execution service and feeds results into the viewer.
 *
 * Everything offline-first.  No network calls.
 */

import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useReportsUiStore } from "../../stores/reports.store";
import { useServiceContext } from "../common/service-context";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import { ReportSidebar } from "./report-sidebar";
import { ReportViewer } from "./report-viewer";
import { ReportFreshnessBanner } from "./report-freshness-banner";
import { ReportErrorState } from "./report-error-state";
import { ReportEmptyState } from "./report-empty-state";
import { ReportConfigDisabledException, ReportExecutionException, ReportFiltersNotReadyException, ReportPermissionDeniedException } from "../../../domain/reports/exceptions";
import { getReportDefinition, listReportsForRole, reportConfigSatisfied } from "../../../domain/reports/report-catalog";
import { assertReportAccess } from "../../../domain/reports/report-permissions";
import { useReportConfigContext } from "./use-report-config-context";
import type { ReportResponse } from "../../../domain/reports/report-types";

export const ReportsPage: FC = () => {
  const { t } = useTranslation();
  const services = useServiceContext();
  const session = useLocalSessionStore((s) => s.session);
  const role = session?.role ?? null;
  const userId = session?.userId ?? null;

  const activeCode = useReportsUiStore((s) => s.activeReportCode);
  const appliedFilters = useReportsUiStore((s) => s.appliedFilters);
  const setActiveReport = useReportsUiStore((s) => s.setActiveReport);
  const setLoading = useReportsUiStore((s) => s.setLoading);
  const setError = useReportsUiStore((s) => s.setError);
  const setResponse = useReportsUiStore((s) => s.setLastResponse);
  const isLoading = useReportsUiStore((s) => s.isLoading);
  const error = useReportsUiStore((s) => s.error);
  const lastResponse = useReportsUiStore((s) => s.lastResponse);
  const [notReady, setNotReady] = useState(false);
  const configContext = useReportConfigContext();

  const availableReports = useMemo(
    () => listReportsForRole(role, configContext),
    [role, configContext],
  );
  const hasReports = availableReports.length > 0;

  // Auto-select the first available report if none is chosen yet.
  useEffect(() => {
    if (!activeCode && hasReports) {
      setActiveReport(availableReports[0].code);
    } else if (activeCode && !availableReports.some((r) => r.code === activeCode)) {
      setActiveReport(hasReports ? availableReports[0].code : null);
    }
  }, [activeCode, availableReports, hasReports, setActiveReport]);

  const execute = useCallback(async () => {
    if (!activeCode || !session) return;
    const def = getReportDefinition(activeCode);
    try {
      assertReportAccess(activeCode, role);
    } catch (err) {
      if (err instanceof ReportPermissionDeniedException) {
        setError(t("reports.error.title"));
        return;
      }
      throw err;
    }
    // Config-gated reports must not even attempt to run when the purchases
    // config does not enable them — avoids a transient error flash while
    // the auto-select effect resets a stale active report.
    if (!reportConfigSatisfied(def, configContext)) {
      setError(t("reports.error.config_disabled"));
      return;
    }
    setLoading(true);
    setNotReady(false);
    try {
      const response: ReportResponse = await services.reportExecutionService.run({
        code: activeCode,
        filters: appliedFilters ?? def.defaultFilters,
        session,
        effectiveConfig: configContext,
        t: t as (key: string, fallback?: string) => string,
      });
      setResponse(response);
    } catch (err) {
      if (err instanceof ReportFiltersNotReadyException) {
        setNotReady(true);
      } else if (err instanceof ReportConfigDisabledException) {
        setError(t(err.messageKey));
      } else if (err instanceof ReportExecutionException) {
        setError(err.message);
      } else if (err instanceof ReportPermissionDeniedException) {
        setError(t("reports.error.title"));
      } else {
        setError(t("reports.error.body"));
      }
    }
  }, [activeCode, appliedFilters, role, session, services, configContext, setError, setLoading, setResponse, t]);

  // Run the report whenever the active code or filter changes.
  useEffect(() => {
    if (activeCode && session) {
      void execute();
    }
    // We intentionally leave `execute` out of the deps so the effect
    // doesn't refire on every render — filters are applied through a
    // dedicated dispatch (see viewer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCode, appliedFilters, session?.userId, userId, session?.workstationId]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-1 border-b border-border px-6 py-4">
        <h1 className="text-h2">{t("reports.title")}</h1>
        <p className="text-body-sm text-muted">{t("reports.subtitle")}</p>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <ReportSidebar />
        <section className="flex-1 overflow-y-auto px-6 py-4">
          {error ? (
            <ReportErrorState message={error} onRetry={execute} />
          ) : !hasReports ? (
            <ReportEmptyState
              title={t("reports.empty.title")}
              body={t("reports.sidebar.no_reports")}
            />
          ) : (
            <>
              {lastResponse ? <ReportFreshnessBanner freshness={lastResponse.freshness} /> : null}
              <ReportViewer onExecute={execute} isLoading={isLoading} notReady={notReady} />
            </>
          )}
        </section>
      </div>
    </div>
  );
};
