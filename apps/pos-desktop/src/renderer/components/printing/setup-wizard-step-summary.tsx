/**
 * SetupWizardStepSummary — final summary before saving the configuration.
 *
 * Shows a detailed overview of what was configured per printer, the job
 * assignments, and the fallback chain. The user can review and then save.
 */

import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import type { WizardState } from './setup-wizard.page';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SetupWizardStepSummaryProps {
  state: WizardState;
  /** Called when the user clicks "Guardar y empezar". */
  onComplete: () => void;
}

// ---------------------------------------------------------------------------
// Labels (mirrors the wizard page constants for display)
// ---------------------------------------------------------------------------

const JOB_TYPE_LABELS: Record<string, string> = {
  SALE_RECEIPT: 'Recibos de venta',
  ELECTRONIC_INVOICE: 'Facturas electrónicas',
  CREDIT_NOTE: 'Notas crédito',
  CONTINGENCY_RECEIPT: 'Recibos de contingencia',
  INVENTORY_REPORT: 'Reportes de inventario',
  SHIFT_CLOSE_REPORT: 'Cierres de turno',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SetupWizardStepSummary: FC<
  SetupWizardStepSummaryProps
> = ({ state, onComplete }) => {
  const { t } = useTranslation();

  const totalPrinters = state.selected.length;
  const configuredPrinters = state.selected.filter(
    (p) =>
      (state.jobAssignments[p.systemName] ?? []).length > 0,
  ).length;
  const withFallback = state.selected.filter((p) => {
    const config = state.fallbackConfig[p.systemName];
    return config?.fallbackPrinterId ?? config?.serverFallback ?? false;
  }).length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex h-full flex-col"
    >
      <div className="mb-4">
        <h2 className="text-ui font-semibold text-ink">
          {t(
            'printing.wizard.summary.title',
            'Resumen de configuración',
          )}
        </h2>
        <p className="mt-1 text-body-sm text-gray-500">
          {t(
            'printing.wizard.summary.subtitle',
            'Revise la configuración antes de guardar. Puede volver atrás para hacer cambios.',
          )}
        </p>
      </div>

      {/* Overall stats */}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="rounded bg-pharma/5 px-3 py-2 text-center">
          <span className="font-data text-lg font-bold tabular-nums text-pharma">
            {totalPrinters}
          </span>
          <p className="text-caption text-gray-500">
            {t(
              'printing.wizard.summary.total_printers',
              'Impresora(s) configurada(s)',
            )}
          </p>
        </div>
        <div className="rounded bg-green-50 px-3 py-2 text-center">
          <span className="font-data text-lg font-bold tabular-nums text-green-700">
            {configuredPrinters}
          </span>
          <p className="text-caption text-green-600">
            {t(
              'printing.wizard.summary.with_jobs',
              'Con trabajos asignados',
            )}
          </p>
        </div>
        <div className="rounded bg-blue-50 px-3 py-2 text-center">
          <span className="font-data text-lg font-bold tabular-nums text-blue-700">
            {withFallback}
          </span>
          <p className="text-caption text-blue-600">
            {t(
              'printing.wizard.summary.with_fallback',
              'Con respaldo configurado',
            )}
          </p>
        </div>
      </div>

      {/* Per-printer detail */}
      <div className="flex-1 space-y-3 overflow-y-auto">
        {state.selected.map((printer, i) => {
          const displayName =
            state.friendlyNames[printer.systemName] ??
            printer.friendlyName;
          const jobs =
            state.jobAssignments[printer.systemName] ?? [];
          const fallback = state.fallbackConfig[printer.systemName];

          let fallbackText = '';
          if (fallback?.serverFallback) {
            fallbackText = t(
              'printing.wizard.summary.fallback_server',
              'Servidor central',
            );
          } else if (fallback?.fallbackPrinterId) {
            fallbackText =
              state.friendlyNames[fallback.fallbackPrinterId] ??
              fallback.fallbackPrinterId;
          } else {
            fallbackText = t(
              'printing.wizard.summary.fallback_none',
              'Sin respaldo',
            );
          }

          return (
            <motion.div
              key={printer.systemName}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.2 }}
              className="pos-panel p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-body-sm font-semibold text-ink">
                    {displayName}
                  </h3>
                  <p className="text-caption text-gray-400">
                    {printer.systemName}
                  </p>
                </div>

                {/* Test result badge */}
                {state.testResults[printer.systemName] === true && (
                  <span className="rounded bg-green-50 px-2 py-0.5 text-caption font-medium text-green-700">
                    {t(
                      'printing.wizard.summary.tested_ok',
                      'Verificada',
                    )}
                  </span>
                )}
                {state.testResults[printer.systemName] === false && (
                  <span className="rounded bg-red-50 px-2 py-0.5 text-caption font-medium text-red-600">
                    {t(
                      'printing.wizard.summary.tested_fail',
                      'Error en prueba',
                    )}
                  </span>
                )}
              </div>

              {/* Jobs */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {jobs.length > 0 ? (
                  jobs.map((job) => (
                    <span
                      key={job}
                      className="rounded bg-gray-100 px-2 py-0.5 text-caption font-medium text-gray-600"
                    >
                      {t(
                        `printing.job_type.${job}`,
                        JOB_TYPE_LABELS[job] ?? job,
                      )}
                    </span>
                  ))
                ) : (
                  <span className="text-caption text-gray-400">
                    {t(
                      'printing.wizard.summary.no_jobs',
                      'Sin trabajos asignados',
                    )}
                  </span>
                )}
              </div>

              {/* Fallback */}
              <div className="mt-2 flex items-center gap-1.5 text-caption text-gray-500">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
                  <path d="M4 15h1" />
                  <path d="M8 15h1" />
                  <path d="M12 15h1" />
                </svg>
                <span>
                  {t(
                    'printing.wizard.summary.fallback_label',
                    'Respaldo: {{name}}',
                    { name: fallbackText },
                  )}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Save button */}
      <motion.button
        type="button"
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
        className="pos-button pos-button-primary mt-6 self-start px-8 py-3 text-ui"
        onClick={onComplete}
      >
        {t(
          'printing.wizard.summary.save',
          'Guardar configuración',
        )}
      </motion.button>
    </motion.div>
  );
};
