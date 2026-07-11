/**
 * SetupWizardStepJobAssignment — job-type-to-printer assignment.
 *
 * For each selected printer, displays a column of checkboxes for every
 * job type. Smart defaults are pre-checked based on the printer type
 * but can be freely edited.
 */

import {
  type FC,
  type Dispatch,
  type SetStateAction,
  useCallback,
} from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import type { WizardState } from './setup-wizard.page';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SetupWizardStepJobAssignmentProps {
  state: WizardState;
  setState: Dispatch<SetStateAction<WizardState>>;
}

// ---------------------------------------------------------------------------
// Job-type constants
// ---------------------------------------------------------------------------

/** Job types available in the wizard (excludes TEST_PAGE and OTHER). */
const WIZARD_JOB_TYPES = [
  'SALE_RECEIPT',
  'ELECTRONIC_INVOICE',
  'CREDIT_NOTE',
  'CONTINGENCY_RECEIPT',
  'INVENTORY_REPORT',
  'SHIFT_CLOSE_REPORT',
] as const;

const JOB_TYPE_LABELS: Record<string, string> = {
  SALE_RECEIPT: 'Recibos de venta',
  ELECTRONIC_INVOICE: 'Facturas electrónicas',
  CREDIT_NOTE: 'Notas crédito',
  CONTINGENCY_RECEIPT: 'Recibos de contingencia',
  INVENTORY_REPORT: 'Reportes de inventario',
  SHIFT_CLOSE_REPORT: 'Cierres de turno',
};

/** Smart defaults based on printer type — mirrors the page's SMART_JOB_DEFAULTS. */
const SMART_JOB_DEFAULTS: Record<string, string[]> = {
  THERMAL_RECEIPT: ['SALE_RECEIPT', 'CONTINGENCY_RECEIPT'],
  THERMAL_LABEL: [],
  LASER: [
    'ELECTRONIC_INVOICE',
    'CREDIT_NOTE',
    'INVENTORY_REPORT',
    'SHIFT_CLOSE_REPORT',
  ],
  INKJET: [
    'ELECTRONIC_INVOICE',
    'CREDIT_NOTE',
    'INVENTORY_REPORT',
    'SHIFT_CLOSE_REPORT',
  ],
  MULTIFUNCTION: ['ELECTRONIC_INVOICE', 'CREDIT_NOTE'],
  UNKNOWN: ['SALE_RECEIPT'],
};

// ---------------------------------------------------------------------------
// Helper: resolve currently assigned jobs for a printer
// ---------------------------------------------------------------------------

function getAssignedJobs(
  state: WizardState,
  systemName: string,
  printerType: string,
): string[] {
  const saved = state.jobAssignments[systemName];
  if (saved && saved.length > 0) return saved;
  return SMART_JOB_DEFAULTS[printerType] ?? [];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SetupWizardStepJobAssignment: FC<
  SetupWizardStepJobAssignmentProps
> = ({ state, setState }) => {
  const { t } = useTranslation();

  const handleToggle = useCallback(
    (systemName: string, jobType: string, checked: boolean) => {
      setState((prev) => {
        const current = prev.jobAssignments[systemName] ?? [];
        return {
          ...prev,
          jobAssignments: {
            ...prev.jobAssignments,
            [systemName]: checked
              ? [...current, jobType]
              : current.filter((j) => j !== jobType),
          },
        };
      });
    },
    [setState],
  );

  if (state.selected.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center">
        <p className="text-body-sm text-gray-400">
          {t(
            'printing.wizard.job_assignment.no_printers',
            'No hay impresoras seleccionadas. Vuelva atrás y seleccione al menos una.',
          )}
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div className="mb-4">
        <h2 className="text-ui font-semibold text-ink">
          {t(
            'printing.wizard.job_assignment.title',
            'Asignación de trabajos',
          )}
        </h2>
        <p className="mt-1 text-body-sm text-gray-500">
          {t(
            'printing.wizard.job_assignment.subtitle',
            'Indique qué tipo de trabajos debe imprimir cada impresora. Los valores sugeridos se basan en el tipo de impresora.',
          )}
        </p>
      </div>

      {/* Printer columns */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {state.selected.map((printer, i) => {
          const assigned = getAssignedJobs(
            state,
            printer.systemName,
            printer.printerType,
          );
          const displayName =
            state.friendlyNames[printer.systemName] ??
            printer.friendlyName;

          return (
            <motion.div
              key={printer.systemName}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.25 }}
              className="pos-panel p-4"
            >
              {/* Printer header */}
              <div className="mb-3 border-b pb-2">
                <h3 className="truncate text-body-sm font-semibold text-ink">
                  {displayName}
                </h3>
                <p className="truncate text-caption text-gray-400">
                  {printer.systemName}
                </p>
              </div>

              {/* Job type checkboxes */}
              <div className="space-y-2">
                {WIZARD_JOB_TYPES.map((jobType) => {
                  const checked = assigned.includes(jobType);
                  const isDefault = (
                    SMART_JOB_DEFAULTS[printer.printerType] ?? []
                  ).includes(jobType);

                  return (
                    <label
                      key={jobType}
                      className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1 text-body-sm hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          handleToggle(
                            printer.systemName,
                            jobType,
                            e.target.checked,
                          )
                        }
                        className="h-4 w-4 rounded border-gray-300 text-pharma focus:ring-pharma/30"
                      />
                      <span className="flex-1 text-ink">
                        {t(
                          `printing.job_type.${jobType}`,
                          JOB_TYPE_LABELS[jobType] ?? jobType,
                        )}
                      </span>
                      {isDefault && (
                        <span className="rounded bg-pharma/10 px-1.5 py-0.5 text-caption font-medium text-pharma">
                          {t(
                            'printing.wizard.job_assignment.suggested',
                            'Sugerido',
                          )}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
};
