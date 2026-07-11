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

const PAPER_SIZE_LABELS: Record<string, string> = {
  RECEIPT_80MM: '80 mm',
  RECEIPT_58MM: '58 mm',
  RECEIPT_76MM: '76 mm',
  LETTER: 'Carta',
  A4: 'A4',
  LABEL_50X25: 'Etiqueta 50×25',
  LABEL_62X29: 'Etiqueta 62×29',
  LABEL_OTHER: 'Etiqueta',
  CUSTOM: 'Personalizado',
  UNKNOWN: 'Automático',
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

  const handlePaperSizeChange = useCallback(
    (systemName: string, value: string) => {
      setState((prev) => ({
        ...prev,
        paperSizes: {
          ...prev.paperSizes,
          [systemName]: value,
        },
      }));
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
                {/* Paper size selector */}
                <span
                  className="mt-1 inline-flex items-center gap-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="relative">
                    <select
                      value={
                        state.paperSizes[printer.systemName] ?? 'UNKNOWN'
                      }
                      onChange={(e) =>
                        handlePaperSizeChange(
                          printer.systemName,
                          e.target.value,
                        )
                      }
                      className="appearance-none rounded bg-gray-100 pl-1.5 pr-4 py-0.5 text-caption font-medium text-gray-600 cursor-pointer hover:bg-gray-200 focus:outline-none focus:ring-1 focus:ring-pharma"
                      aria-label={t(
                        'printing.wizard.job_assignment.paper_size',
                        'Tamaño de papel',
                      )}
                    >
                      {Object.entries(PAPER_SIZE_LABELS).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                    <svg
                      className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-gray-400"
                      viewBox="0 0 10 6"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M1 1l4 4 4-4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  {printer.detectionConfidence === 'high' && (
                    <svg
                      viewBox="0 0 14 14"
                      fill="none"
                      className="h-3 w-3 shrink-0 text-green-600"
                      aria-label={t(
                        'printing.wizard.job_assignment.confidence_high',
                        'Detección precisa',
                      )}
                    >
                      <path
                        d="M3 7L6 10L11 4"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  {printer.detectionConfidence === 'low' && (
                    <svg
                      viewBox="0 0 14 14"
                      fill="none"
                      className="h-3 w-3 shrink-0 text-amber-500"
                      aria-label={t(
                        'printing.wizard.job_assignment.confidence_low',
                        'Detección incierta',
                      )}
                    >
                      <circle
                        cx="7"
                        cy="7"
                        r="6"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <path
                        d="M5.5 5.5a1.5 1.5 0 012.8-.8c.4.6.2 1.3-.3 1.6l-.5.3v1"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                      />
                      <circle
                        cx="7"
                        cy="10"
                        r="0.5"
                        fill="currentColor"
                      />
                    </svg>
                  )}
                  {printer.detectionConfidence === 'none' && (
                    <svg
                      viewBox="0 0 14 14"
                      fill="none"
                      className="h-3 w-3 shrink-0 text-red-400"
                      aria-label={t(
                        'printing.wizard.job_assignment.confidence_none',
                        'No detectado',
                      )}
                    >
                      <path
                        d="M7 1L1 13h12L7 1z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M7 5v3.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                      <circle
                        cx="7"
                        cy="10.5"
                        r="0.75"
                        fill="currentColor"
                      />
                    </svg>
                  )}
                </span>
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
