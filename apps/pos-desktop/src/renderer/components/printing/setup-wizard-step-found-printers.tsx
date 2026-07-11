/**
 * SetupWizardStepFoundPrinters — checkbox grid of discovered printers.
 *
 * For each discovered printer, a card with a checkbox, editable friendly name,
 * system name, and connection/printer-type badges. Handles the empty state
 * with troubleshooting tips.
 */

import {
  type FC,
  type Dispatch,
  type SetStateAction,
  useCallback,
} from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import type { WizardState } from './setup-wizard.page';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SetupWizardStepFoundPrintersProps {
  state: WizardState;
  setState: Dispatch<SetStateAction<WizardState>>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONNECTION_LABELS: Record<string, string> = {
  USB: 'USB',
  NETWORK: 'Red',
  BLUETOOTH: 'Bluetooth',
  SYSTEM_DEFAULT: 'Sistema',
};

const PRINTER_TYPE_LABELS: Record<string, string> = {
  THERMAL_RECEIPT: 'Térmica (recibos)',
  THERMAL_LABEL: 'Térmica (etiquetas)',
  LASER: 'Láser',
  INKJET: 'Inyección',
  MULTIFUNCTION: 'Multifunción',
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SetupWizardStepFoundPrinters: FC<
  SetupWizardStepFoundPrintersProps
> = ({ state, setState }) => {
  const { t } = useTranslation();

  const isSelected = useCallback(
    (systemName: string) =>
      state.selected.some((p) => p.systemName === systemName),
    [state.selected],
  );

  const handleToggle = useCallback(
    (printer: (typeof state.discovered)[number]) => {
      setState((prev) => {
        const alreadySelected = prev.selected.some(
          (p) => p.systemName === printer.systemName,
        );
        return {
          ...prev,
          selected: alreadySelected
            ? prev.selected.filter(
                (p) => p.systemName !== printer.systemName,
              )
            : [...prev.selected, printer],
          friendlyNames: {
            ...prev.friendlyNames,
            [printer.systemName]:
              prev.friendlyNames[printer.systemName] ??
              printer.friendlyName,
          },
        };
      });
    },
    [setState],
  );

  const handleFriendlyNameChange = useCallback(
    (systemName: string, value: string) => {
      setState((prev) => ({
        ...prev,
        friendlyNames: {
          ...prev.friendlyNames,
          [systemName]: value,
        },
      }));
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
            'printing.wizard.found_printers.title',
            'Impresoras encontradas',
          )}
        </h2>
        <p className="mt-1 text-body-sm text-gray-500">
          {t(
            'printing.wizard.found_printers.subtitle',
            'Seleccione las impresoras que desea configurar y asígneles un nombre descriptivo.',
          )}
        </p>
      </div>

      {/* Printer cards grid */}
      {state.discovered.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {state.discovered.map((printer, i) => {
              const selected = isSelected(printer.systemName);
              const connectionLabel =
                CONNECTION_LABELS[printer.connection] ??
                printer.connection;
              const typeLabel =
                PRINTER_TYPE_LABELS[printer.printerType] ??
                printer.printerType;

              return (
                <motion.div
                  key={printer.systemName}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.25 }}
                  layout
                  className={`pos-panel cursor-pointer border-2 p-4 transition-colors ${
                    selected
                      ? 'border-pharma'
                      : 'border-transparent hover:border-gray-200'
                  }`}
                  onClick={() => handleToggle(printer)}
                  role="option"
                  aria-selected={selected}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleToggle(printer);
                    }
                  }}
                >
                  {/* Header: checkbox + name */}
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      {/* Editable friendly name */}
                      <input
                        type="text"
                        value={
                          state.friendlyNames[printer.systemName] ??
                          printer.friendlyName
                        }
                        onChange={(e) =>
                          handleFriendlyNameChange(
                            printer.systemName,
                            e.target.value,
                          )
                        }
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="w-full border-b border-transparent bg-transparent text-body-sm font-medium text-ink outline-none hover:border-gray-300 focus:border-pharma"
                        aria-label={t(
                          'printing.wizard.found_printers.name_label',
                          'Nombre descriptivo',
                        )}
                        placeholder={printer.friendlyName}
                      />
                      <p className="mt-0.5 truncate text-caption text-gray-400">
                        {printer.systemName}
                      </p>
                    </div>

                    {/* Checkbox */}
                    <span
                      className={`ml-3 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                        selected
                          ? 'border-pharma bg-pharma'
                          : 'border-gray-300 bg-white'
                      }`}
                      aria-hidden="true"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {selected && (
                        <svg
                          viewBox="0 0 14 14"
                          fill="none"
                          className="h-3 w-3 text-white"
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
                    </span>
                  </div>

                  {/* Badges row */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-caption font-medium text-gray-600">
                      {connectionLabel}
                    </span>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-caption font-medium text-gray-600">
                      {typeLabel}
                    </span>
                    {printer.supportsColor && (
                      <span className="rounded bg-purple-50 px-2 py-0.5 text-caption font-medium text-purple-700">
                        {t(
                          'printing.wizard.found_printers.color',
                          'Color',
                        )}
                      </span>
                    )}
                    {printer.isDefault && (
                      <span className="rounded bg-pharma/10 px-2 py-0.5 text-caption font-medium text-pharma">
                        {t(
                          'printing.wizard.found_printers.default',
                          'Predet.',
                        )}
                      </span>
                    )}
                    {/* Paper size override */}
                    <span
                      className="relative inline-flex items-center gap-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="relative">
                        <select
                          value={
                            state.paperSizes[printer.systemName] ??
                            'UNKNOWN'
                          }
                          onChange={(e) =>
                            handlePaperSizeChange(
                              printer.systemName,
                              e.target.value,
                            )
                          }
                          className="appearance-none rounded bg-gray-100 pl-1.5 pr-4 py-0.5 text-caption font-medium text-gray-600 cursor-pointer hover:bg-gray-200 focus:outline-none focus:ring-1 focus:ring-pharma"
                          aria-label={t(
                            'printing.wizard.found_printers.paper_size',
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
                            'printing.wizard.found_printers.confidence_high',
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
                            'printing.wizard.found_printers.confidence_low',
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
                            'printing.wizard.found_printers.confidence_none',
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
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      ) : (
        /* Empty state */
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto mt-8 max-w-md rounded border border-urgency/30 bg-urgency-surface p-5 text-center"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto mb-3 text-urgency"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
          <p className="text-body-sm font-semibold text-urgency">
            {t(
              'printing.wizard.found_printers.no_printers',
              'No se encontraron impresoras',
            )}
          </p>
          <ul className="mt-3 space-y-1 text-left text-caption text-gray-600">
            <li>
              {t(
                'printing.wizard.found_printers.tip_power',
                '• Verifique que la impresora esté encendida y conectada',
              )}
            </li>
            <li>
              {t(
                'printing.wizard.found_printers.tip_usb',
                '• Si usa USB, pruebe otro puerto',
              )}
            </li>
            <li>
              {t(
                'printing.wizard.found_printers.tip_network',
                '• Active la búsqueda en red para impresoras de red',
              )}
            </li>
            <li>
              {t(
                'printing.wizard.found_printers.tip_drivers',
                '• Asegúrese de que los controladores estén instalados',
              )}
            </li>
          </ul>
        </motion.div>
      )}

      {/* Selection count */}
      {state.discovered.length > 0 && (
        <p className="mt-4 text-caption text-gray-400">
          {t(
            'printing.wizard.found_printers.selected_count',
            '{{count}} de {{total}} seleccionada(s)',
            {
              count: state.selected.length,
              total: state.discovered.length,
            },
          )}
        </p>
      )}
    </motion.div>
  );
};
