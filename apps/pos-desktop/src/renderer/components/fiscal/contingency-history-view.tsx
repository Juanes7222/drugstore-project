/**
 * Contingency history view — table of DIAN contingency events.
 *
 * Extracted from the legacy fiscal.page.tsx. Shows start/end timestamps,
 * trigger type, and invoice counts per event.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type { ContingencyEventSummary } from "../../../domain/fiscal/fiscal-types";

interface ContingencyHistoryViewProps {
  history: ContingencyEventSummary[];
}

const triggerLabelKey = (trigger: string): string => {
  switch (trigger) {
    case "NETWORK_LOST":
      return "fiscal.trigger_network_lost";
    case "MANUAL_OVERRIDE":
      return "fiscal.trigger_manual_override";
    case "SERVER_UNREACHABLE":
      return "fiscal.trigger_server_unreachable";
    default:
      return trigger;
  }
};

export const ContingencyHistoryView: FC<ContingencyHistoryViewProps> = ({
  history,
}) => {
  const { t } = useTranslation();

  const formatDateTime = (dateStr: string): string =>
    new Date(dateStr).toLocaleString("es-CO");

  return (
    <div className="pos-panel" role="region" aria-label={t("fiscal.tab_contingency")}>
      <div className="border-b px-4 py-3" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}>
        <h2 className="text-caption font-semibold uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
          {t("fiscal.tab_contingency")}
        </h2>
      </div>

      {history.length === 0 ? (
        <div className="px-4 py-12 text-center text-caption" style={{ color: "color-mix(in srgb, var(--color-ink) 40%, transparent)" }}>
          {t("fiscal.no_contingency")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y text-body-sm" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }} role="table" aria-label={t("fiscal.tab_contingency")}>
            <thead>
              <tr>
                <th scope="col" className="px-4 py-2 text-left text-caption font-semibold uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)", backgroundColor: "color-mix(in srgb, var(--color-surface) 60%, white)" }}>
                  {t("fiscal.table_invoice_start")}
                </th>
                <th scope="col" className="px-4 py-2 text-left text-caption font-semibold uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)", backgroundColor: "color-mix(in srgb, var(--color-surface) 60%, white)" }}>
                  {t("fiscal.table_invoice_end")}
                </th>
                <th scope="col" className="px-4 py-2 text-left text-caption font-semibold uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)", backgroundColor: "color-mix(in srgb, var(--color-surface) 60%, white)" }}>
                  {t("fiscal.table_trigger")}
                </th>
                <th scope="col" className="px-4 py-2 text-right text-caption font-semibold uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)", backgroundColor: "color-mix(in srgb, var(--color-surface) 60%, white)" }}>
                  {t("fiscal.table_generated")}
                </th>
                <th scope="col" className="px-4 py-2 text-right text-caption font-semibold uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)", backgroundColor: "color-mix(in srgb, var(--color-surface) 60%, white)" }}>
                  {t("fiscal.table_transmitted")}
                </th>
                <th scope="col" className="px-4 py-2 text-right text-caption font-semibold uppercase tracking-wide" style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)", backgroundColor: "color-mix(in srgb, var(--color-surface) 60%, white)" }}>
                  {t("fiscal.table_expired")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "color-mix(in srgb, var(--color-ink) 6%, transparent)" }}>
              {history.map((evt) => (
                <tr
                  key={evt.id}
                  className="transition-colors hover:bg-surface"
                  style={{ backgroundColor: "color-mix(in srgb, var(--color-surface) 30%, white)" }}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-body-sm" style={{ color: "var(--color-ink)" }}>
                    {formatDateTime(evt.startedAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-caption" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
                    {evt.endedAt ? formatDateTime(evt.endedAt) : t("fiscal.trigger_active")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-caption" style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}>
                    {t(triggerLabelKey(evt.trigger))}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-data tabular-nums text-right text-body-sm" style={{ color: "var(--color-ink)" }}>
                    {evt.invoicesGenerated}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-data tabular-nums text-right text-body-sm" style={{ color: "var(--color-ink)" }}>
                    {evt.invoicesTransmitted}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-data tabular-nums text-right text-body-sm" style={{ color: "var(--color-ink)" }}>
                    {evt.invoicesExpired}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
