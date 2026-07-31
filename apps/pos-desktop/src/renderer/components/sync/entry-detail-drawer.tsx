/**
 * Right-side slide-out drawer showing non-technical details for a sync entry.
 *
 * Exposes only what a pharmacy staff user needs: operation type, failure
 * category, a one-line error (no stack trace), dates in Spanish, and a
 * human-readable payload summary.  UUIDs, raw JSON, and stack traces are
 * deliberately excluded.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { AlertTriangleIcon, CalendarClockIcon, RotateCwIcon, XIcon } from "@/components/ui/icons";
import type { PermanentFailureEntry } from "../../../domain/sync/sync-metrics.service";
import { formatRelativeTimeEs } from "../../hooks/use-relative-time";
import { summarizePayload, truncateError } from "./sync-utils";

interface EntryDetailDrawerProps {
  entry: PermanentFailureEntry;
  onClose: () => void;
}

export const EntryDetailDrawer: FC<EntryDetailDrawerProps> = ({
  entry,
  onClose,
}) => {
  const { t } = useTranslation();

  const translatedOpType = t(`sync.op_type.${entry.operationType}`, {
    defaultValue: entry.operationType,
  });

  const translatedCategory = entry.failureCategory
    ? t(`sync.failure_cat.${entry.failureCategory}`, {
        defaultValue: entry.failureCategory,
      })
    : null;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-40 bg-ink/20"
        onClick={onClose}
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      />

      {/* Drawer panel */}
      <motion.aside
        className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col overflow-y-auto border-l border-border bg-panel shadow-pos-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("sync.entry_detail_title")}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-body font-semibold text-ink">
            {t("sync.entry_detail_title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-muted transition-colors hover:bg-surface hover:text-ink focus:outline-none focus:ring-2 focus:ring-pharma"
            aria-label={t("common.close")}
          >
            <XIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* ── Content ── */}
        <div className="flex-1 space-y-5 p-4">
          {/* ── Summary card ── */}
          <section className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-semibold text-ink">
                  {translatedOpType}
                </p>
                {translatedCategory && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-error-container px-2 py-0.5 text-caption font-medium text-error">
                    <AlertTriangleIcon className="h-3 w-3" aria-hidden="true" />
                    {translatedCategory}
                  </span>
                )}
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-pharma/10 px-2 py-0.5 text-caption font-medium text-pharma">
                <RotateCwIcon className="h-3 w-3" aria-hidden="true" />
                {entry.retryCount.toLocaleString()}{" "}
                {entry.retryCount === 1
                  ? t("sync.detail_retry_singular")
                  : t("sync.detail_retry_plural")}
              </span>
            </div>
          </section>

          {/* ── Error message (truncated, no stack trace) ── */}
          {entry.lastErrorMessage && (
            <section>
              <h3 className="mb-2 text-caption font-semibold uppercase tracking-wider text-ink-muted">
                {t("sync.detail_error")}
              </h3>
              <div className="rounded-lg border border-error-container bg-error-container/40 p-3 font-data text-caption text-error">
                {truncateError(entry.lastErrorMessage)}
              </div>
            </section>
          )}

          {/* ── Timeline ── */}
          <section>
            <h3 className="mb-2 text-caption font-semibold uppercase tracking-wider text-ink-muted">
              <CalendarClockIcon className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true" />
              {t("sync.detail_timeline")}
            </h3>
            <dl className="space-y-2 text-body-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">{t("sync.detail_created")}</dt>
                <dd className="font-data text-caption text-ink tabular-nums">
                  {formatRelativeTimeEs(entry.sourceCreatedAt)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">{t("sync.detail_last_attempt")}</dt>
                <dd className="font-data text-caption text-ink tabular-nums">
                  {entry.lastAttemptAt
                    ? formatRelativeTimeEs(entry.lastAttemptAt)
                    : "\u2014"}
                </dd>
              </div>
            </dl>
          </section>

          {/* ── Payload summary (human-readable, no raw JSON) ── */}
          {entry.payloadPreview && (
            <section>
              <h3 className="mb-2 text-caption font-semibold uppercase tracking-wider text-ink-muted">
                {t("sync.detail_payload_summary")}
              </h3>
              <div className="rounded-lg bg-surface p-3 font-data text-caption text-ink">
                {summarizePayload(entry.payloadPreview, t)}
              </div>
            </section>
          )}

          {/* ── Retry History ── */}
          <section>
            <h3 className="mb-2 text-caption font-semibold uppercase tracking-wider text-ink-muted">
              {t("sync.detail_retry_history")}
            </h3>
            <div className="rounded-lg bg-surface p-4 text-center text-body-sm text-ink-muted">
              {t("sync.retry_history_empty")}
            </div>
          </section>

          {/* ── Recovery Actions ── */}
          <section>
            <h3 className="mb-2 text-caption font-semibold uppercase tracking-wider text-ink-muted">
              {t("sync.detail_recovery_actions")}
            </h3>
            <div className="rounded-lg bg-surface p-4 text-center text-body-sm text-ink-muted">
              {t("sync.recovery_actions_empty")}
            </div>
          </section>
        </div>
      </motion.aside>
    </>
  );
};
