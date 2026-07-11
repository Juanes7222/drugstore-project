/**
 * SetupWizardStepFallbackConfig — fallback printer chain configuration.
 *
 * For each selected printer, the user can choose a fallback option:
 * - Another configured printer on this workstation
 * - The server (for remote printing)
 * - None (just queue the job and alert the user)
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

export interface SetupWizardStepFallbackConfigProps {
  state: WizardState;
  setState: Dispatch<SetStateAction<WizardState>>;
}

// ---------------------------------------------------------------------------
// Fallback option types
// ---------------------------------------------------------------------------

type FallbackValue = 'none' | 'server';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SetupWizardStepFallbackConfig: FC<
  SetupWizardStepFallbackConfigProps
> = ({ state, setState }) => {
  const { t } = useTranslation();

  const handleChange = useCallback(
    (
      printerSystemName: string,
      value: FallbackValue | string,
    ) => {
      setState((prev) => {
        if (value === 'none') {
          return {
            ...prev,
            fallbackConfig: {
              ...prev.fallbackConfig,
              [printerSystemName]: {
                fallbackPrinterId: null,
                serverFallback: false,
              },
            },
          };
        }
        if (value === 'server') {
          return {
            ...prev,
            fallbackConfig: {
              ...prev.fallbackConfig,
              [printerSystemName]: {
                fallbackPrinterId: null,
                serverFallback: true,
              },
            },
          };
        }
        // value is a printer systemName
        return {
          ...prev,
          fallbackConfig: {
            ...prev.fallbackConfig,
            [printerSystemName]: {
              fallbackPrinterId: value,
              serverFallback: false,
            },
          },
        };
      });
    },
    [setState],
  );

  const getSelectedValue = useCallback(
    (systemName: string): string => {
      const config = state.fallbackConfig[systemName];
      if (!config) return 'none';
      if (config.serverFallback) return 'server';
      return config.fallbackPrinterId ?? 'none';
    },
    [state.fallbackConfig],
  );

  if (state.selected.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center">
        <p className="text-body-sm text-gray-400">
          {t(
            'printing.wizard.job_assignment.no_printers',
            'No hay impresoras seleccionadas.',
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
            'printing.wizard.fallback.title',
            'Configuración de respaldo',
          )}
        </h2>
        <p className="mt-1 text-body-sm text-gray-500">
          {t(
            'printing.wizard.fallback.subtitle',
            'Configure una impresora de respaldo para cada equipo. Si la impresora principal falla, el trabajo se redirigirá automáticamente.',
          )}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {state.selected.map((printer, i) => {
          const displayName =
            state.friendlyNames[printer.systemName] ??
            printer.friendlyName;
          const selectedValue = getSelectedValue(printer.systemName);
          const nameAttr = `fallback-${printer.systemName}`;

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

              {/* Fallback options */}
              <fieldset className="space-y-2.5">
                <legend className="mb-2 text-caption font-medium text-gray-500">
                  {t(
                    'printing.wizard.fallback.if_fails',
                    'Si esta impresora falla:',
                  )}
                </legend>

                {/* Option: another printer */}
                {state.selected
                  .filter(
                    (other) =>
                      other.systemName !== printer.systemName,
                  )
                  .map((other) => {
                    const otherName =
                      state.friendlyNames[other.systemName] ??
                      other.friendlyName;
                    const isSelected =
                      selectedValue === other.systemName;

                    return (
                      <label
                        key={other.systemName}
                        className={`flex cursor-pointer items-center gap-2.5 rounded px-3 py-2 text-body-sm transition-colors ${
                          isSelected
                            ? 'bg-pharma/5 ring-1 ring-pharma/20'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name={nameAttr}
                          value={other.systemName}
                          checked={isSelected}
                          onChange={() =>
                            handleChange(
                              printer.systemName,
                              other.systemName,
                            )
                          }
                          className="h-4 w-4 border-gray-300 text-pharma focus:ring-pharma/30"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-ink">
                            {otherName}
                          </p>
                          <p className="truncate text-caption text-gray-400">
                            {t(
                              'printing.wizard.fallback.local_printer',
                              'Impresora local',
                            )}
                          </p>
                        </div>
                      </label>
                    );
                  })}

                {/* Option: server */}
                <label
                  className={`flex cursor-pointer items-center gap-2.5 rounded px-3 py-2 text-body-sm transition-colors ${
                    selectedValue === 'server'
                      ? 'bg-pharma/5 ring-1 ring-pharma/20'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name={nameAttr}
                    value="server"
                    checked={selectedValue === 'server'}
                    onChange={() =>
                      handleChange(printer.systemName, 'server')
                    }
                    className="h-4 w-4 border-gray-300 text-pharma focus:ring-pharma/30"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">
                      {t(
                        'printing.wizard.fallback.server_option',
                        'Servidor central',
                      )}
                    </p>
                    <p className="text-caption text-gray-400">
                      {t(
                        'printing.wizard.fallback.server_desc',
                        'Enviar al servidor para imprimir remotamente',
                      )}
                    </p>
                  </div>
                </label>

                {/* Option: none */}
                <label
                  className={`flex cursor-pointer items-center gap-2.5 rounded px-3 py-2 text-body-sm transition-colors ${
                    selectedValue === 'none'
                      ? 'bg-pharma/5 ring-1 ring-pharma/20'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name={nameAttr}
                    value="none"
                    checked={selectedValue === 'none'}
                    onChange={() =>
                      handleChange(printer.systemName, 'none')
                    }
                    className="h-4 w-4 border-gray-300 text-pharma focus:ring-pharma/30"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">
                      {t(
                        'printing.wizard.fallback.none_option',
                        'Sin respaldo',
                      )}
                    </p>
                    <p className="text-caption text-gray-400">
                      {t(
                        'printing.wizard.fallback.none_desc',
                        'Solo guardar el trabajo y notificar al cajero',
                      )}
                    </p>
                  </div>
                </label>
              </fieldset>

              {/* Current selection summary */}
              <div className="mt-3 border-t pt-2 text-caption text-gray-400">
                {selectedValue === 'none' &&
                  t(
                    'printing.wizard.fallback.summary_none',
                    'Sin respaldo configurado',
                  )}
                {selectedValue === 'server' &&
                  t(
                    'printing.wizard.fallback.summary_server',
                    'Respaldo: Servidor central',
                  )}
                {selectedValue !== 'none' &&
                  selectedValue !== 'server' && (
                    <>
                      {t(
                        'printing.wizard.fallback.summary_printer',
                        'Respaldo: ',
                      )}
                      <span className="font-medium text-ink">
                        {state.friendlyNames[selectedValue] ??
                          selectedValue}
                      </span>
                    </>
                  )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
};
