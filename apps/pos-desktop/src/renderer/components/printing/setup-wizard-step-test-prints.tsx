/**
 * SetupWizardStepTestPrints — test print runner for configured printers.
 *
 * Shows per-printer cards with test status (not-tested / success / fail),
 * a "Probar" button per printer, and an overall completion badge.
 */

import {
  type FC,
  type Dispatch,
  type SetStateAction,
  useState,
  useCallback,
} from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import type { WizardState } from './setup-wizard.page';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SetupWizardStepTestPrintsProps {
  state: WizardState;
  setState: Dispatch<SetStateAction<WizardState>>;
  /**
   * Async function to run a test print on a specific printer.
   * The page file wires this to the Tauri `test_print` invoke.
   */
  onTestPrint: (
    systemName: string,
    printerType: string,
  ) => Promise<{ success: boolean; errorMessage?: string }>;
}

// ---------------------------------------------------------------------------
// Status legend
// ---------------------------------------------------------------------------

const STATUS_LEGEND = [
  { status: null, label: 'No probada', dot: 'bg-gray-300' },
  { status: true, label: 'Funciona', dot: 'bg-green-500' },
  { status: false, label: 'Error', dot: 'bg-red-500' },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SetupWizardStepTestPrints: FC<
  SetupWizardStepTestPrintsProps
> = ({ state, setState, onTestPrint }) => {
  const { t } = useTranslation();
  const [testingPrinter, setTestingPrinter] = useState<string | null>(null);

  const handleTest = useCallback(
    async (systemName: string, printerType: string) => {
      setTestingPrinter(systemName);
      try {
        const result = await onTestPrint(systemName, printerType);
        setState((prev) => ({
          ...prev,
          testResults: {
            ...prev.testResults,
            [systemName]: result.success,
          },
        }));
      } catch {
        setState((prev) => ({
          ...prev,
          testResults: {
            ...prev.testResults,
            [systemName]: false,
          },
        }));
      } finally {
        setTestingPrinter(null);
      }
    },
    [onTestPrint, setState],
  );

  const testedCount = state.selected.filter(
    (p) => state.testResults[p.systemName] != null,
  ).length;
  const successCount = state.selected.filter(
    (p) => state.testResults[p.systemName] === true,
  ).length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div className="mb-4">
        <h2 className="text-ui font-semibold text-ink">
          {t(
            'printing.wizard.test_prints.title',
            'Prueba de impresión',
          )}
        </h2>
        <p className="mt-1 text-body-sm text-gray-500">
          {t(
            'printing.wizard.test_prints.subtitle',
            'Verifique que cada impresora configurada funcione correctamente antes de finalizar.',
          )}
        </p>
      </div>

      {/* Status legend */}
      <div className="mb-4 flex items-center gap-4 text-caption text-gray-500">
        {STATUS_LEGEND.map((entry) => {
          const count =
            entry.status === null
              ? state.selected.length - testedCount
              : entry.status
                ? successCount
                : testedCount - successCount;

          return (
            <span
              key={String(entry.status)}
              className="flex items-center gap-1.5"
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${entry.dot}`}
              />
              {entry.label}: {count}
            </span>
          );
        })}
      </div>

      {/* Per-printer cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {state.selected.map((printer, i) => {
          const displayName =
            state.friendlyNames[printer.systemName] ??
            printer.friendlyName;
          const result = state.testResults[printer.systemName];
          const isTesting = testingPrinter === printer.systemName;

          return (
            <motion.div
              key={printer.systemName}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.25 }}
              className="pos-panel p-4"
            >
              {/* Printer header */}
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-body-sm font-semibold text-ink">
                    {displayName}
                  </h3>
                  <p className="truncate text-caption text-gray-400">
                    {printer.systemName}
                  </p>
                </div>

                {/* Status indicator */}
                <div className="ml-3 flex shrink-0 items-center gap-1.5">
                  {isTesting && (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-pharma border-t-transparent" />
                  )}
                  <span
                    className={`inline-block h-3 w-3 rounded-full ${
                      result === null
                        ? 'bg-gray-300'
                        : result
                          ? 'bg-green-500'
                          : 'bg-red-500'
                    }`}
                    aria-hidden="true"
                  />
                </div>
              </div>

              {/* Status message */}
              <p className="mt-2 text-body-sm">
                {result === null && (
                  <span className="text-gray-400">
                    {t(
                      'printing.wizard.test_prints.not_tested',
                      'No probada aún',
                    )}
                  </span>
                )}
                {result === true && (
                  <span className="font-medium text-green-700">
                    {t(
                      'printing.wizard.test_prints.success',
                      '✓ Funciona correctamente',
                    )}
                  </span>
                )}
                {result === false && (
                  <span className="font-medium text-red-600">
                    {t(
                      'printing.wizard.test_prints.failed',
                      '✗ Error en la impresión',
                    )}
                  </span>
                )}
              </p>

              {/* Test button */}
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                disabled={isTesting}
                className={`mt-3 rounded px-4 py-1.5 text-body-sm font-medium transition-colors ${
                  isTesting
                    ? 'bg-gray-100 text-gray-400'
                    : result === true
                      ? 'bg-green-50 text-green-700 hover:bg-green-100'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                onClick={() =>
                  handleTest(printer.systemName, printer.printerType)
                }
              >
                {isTesting
                  ? t(
                      'printing.wizard.test_prints.testing',
                      'Probando...',
                    )
                  : t(
                      'printing.wizard.test_prints.test',
                      result === true ? 'Probar de nuevo' : 'Probar',
                    )}
              </motion.button>

              {/* Error details */}
              {result === false && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-2 text-caption text-red-500"
                >
                  {t(
                    'printing.wizard.test_prints.retry_hint',
                    'Verifique que la impresora esté encendida, con papel y correctamente conectada.',
                  )}
                </motion.p>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Completion summary */}
      {testedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mt-6 rounded px-4 py-3 text-body-sm ${
            successCount === state.selected.length
              ? 'bg-green-50 text-green-800'
              : 'bg-urgency-surface text-urgency'
          }`}
        >
          {successCount === state.selected.length
            ? t(
                'printing.wizard.test_prints.all_passed',
                'Todas las impresoras funcionan correctamente.',
              )
            : t(
                'printing.wizard.test_prints.some_failed',
                '{{success}} de {{total}} impresora(s) funcionan. Revise las que presentan error.',
                {
                  success: successCount,
                  total: state.selected.length,
                },
              )}
        </motion.div>
      )}
    </motion.div>
  );
};
