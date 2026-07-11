/**
 * SetupWizardStepDiscovery — animated discovery progress screen.
 *
 * Shows a pulsing search animation while scanning for printers, lists
 * discovered printers as they appear, and toggles network scan mode.
 */

import { type FC, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import type { WizardState } from './setup-wizard.page';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SetupWizardStepDiscoveryProps {
  state: WizardState;
  setState: Dispatch<SetStateAction<WizardState>>;
}

// ---------------------------------------------------------------------------
// Connection badge colours
// ---------------------------------------------------------------------------

const CONNECTION_BADGE: Record<string, string> = {
  USB: 'bg-blue-100 text-blue-700',
  NETWORK: 'bg-purple-100 text-purple-700',
  BLUETOOTH: 'bg-cyan-100 text-cyan-700',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SetupWizardStepDiscovery: FC<
  SetupWizardStepDiscoveryProps
> = ({ state, setState }) => {
  const { t } = useTranslation();

  const printerCount = state.discovered.length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex h-full flex-col items-center justify-center"
    >
      {/* Status content */}
      <div className="flex flex-col items-center text-center">
        {/* Animated pulse ring */}
        <div className="relative mb-6 flex items-center justify-center">
          <motion.div
            className="absolute h-16 w-16 rounded-full border-2 border-pharma/30"
            animate={{
              scale: [1, 1.3, 1],
              opacity: [0.6, 0, 0.6],
            }}
            transition={{
              duration: 2,
              repeat: Number.POSITIVE_INFINITY,
              ease: 'easeInOut',
            }}
          />
          <motion.div
            className="relative flex h-14 w-14 items-center justify-center rounded-full bg-pharma/10"
            animate={{ rotate: 360 }}
            transition={{
              duration: 2,
              repeat: Number.POSITIVE_INFINITY,
              ease: 'linear',
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-pharma"
              aria-hidden="true"
            >
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
              <rect x="6" y="14" width="12" height="8" rx="1" />
            </svg>
          </motion.div>
        </div>

        <h2 className="text-ui font-semibold text-ink">
          {state.isDiscovering
            ? t(
                'printing.wizard.discovery.searching',
                'Buscando impresoras conectadas...',
              )
            : t(
                'printing.wizard.discovery.found',
                '{{count}} impresora(s) encontrada(s)',
                { count: printerCount },
              )}
        </h2>

        <p className="mt-1 text-body-sm text-gray-500">
          {state.isDiscovering
            ? t(
                'printing.wizard.discovery.searching_hint',
                'Revisando conexiones USB, Bluetooth y red local.',
              )
            : t(
                'printing.wizard.discovery.found_hint',
                'Revise la lista a continuación. Puede activar la búsqueda en red para encontrar más.',
              )}
        </p>
      </div>

      {/* Discovered printers list */}
      <div className="mt-8 w-full max-w-md space-y-2">
        <AnimatePresence mode="popLayout">
          {state.discovered.map((printer, i) => {
            const badgeClass =
              CONNECTION_BADGE[printer.connection] ??
              'bg-gray-100 text-gray-600';

            return (
              <motion.div
                key={printer.systemName}
                initial={{ opacity: 0, x: -20, height: 0 }}
                animate={{ opacity: 1, x: 0, height: 'auto' }}
                transition={{ delay: i * 0.1, duration: 0.3 }}
                className="pos-panel flex items-center gap-3 px-4 py-3"
              >
                {/* Connection icon */}
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gray-100">
                  {printer.connection === 'USB' && (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-gray-500"
                    >
                      <rect x="7" y="2" width="10" height="7" rx="1" />
                      <path d="M12 9v5" />
                      <path d="M5 16a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
                    </svg>
                  )}
                  {(printer.connection === 'NETWORK' ||
                    printer.connection === 'BLUETOOTH') && (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-gray-500"
                    >
                      <path d="M12 2a4 4 0 0 0-4 4v4a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4Z" />
                      <path d="M5 14a7 7 0 0 0 14 0" />
                      <path d="M12 18v4" />
                    </svg>
                  )}
                  {!['USB', 'NETWORK', 'BLUETOOTH'].includes(
                    printer.connection,
                  ) && (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-gray-500"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v8" />
                      <path d="M8 12h8" />
                    </svg>
                  )}
                </span>

                {/* Name + type */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-sm font-medium text-ink">
                    {printer.friendlyName}
                  </p>
                  <p className="truncate text-caption text-gray-400">
                    {printer.systemName}
                  </p>
                </div>

                {/* Connection badge */}
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-caption font-medium ${badgeClass}`}
                >
                  {printer.connection}
                </span>

                {/* Default badge */}
                {printer.isDefault && (
                  <span className="shrink-0 rounded bg-pharma/10 px-2 py-0.5 text-caption font-medium text-pharma">
                    {t('printing.wizard.discovery.default', 'Predet.')}
                  </span>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Network scan toggle */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        className="mt-6 flex items-center gap-2 text-body-sm text-pharma hover:text-pharma/80"
        onClick={() =>
          setState((prev) => ({
            ...prev,
            networkScanEnabled: !prev.networkScanEnabled,
          }))
        }
        aria-pressed={state.networkScanEnabled}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded border ${
            state.networkScanEnabled
              ? 'border-pharma bg-pharma'
              : 'border-gray-300 bg-white'
          }`}
          aria-hidden="true"
        >
          {state.networkScanEnabled && (
            <svg
              viewBox="0 0 14 14"
              fill="none"
              className="text-white"
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
        {t(
          'printing.wizard.discovery.network_scan',
          'Buscar también en la red local',
        )}
      </motion.button>

      {/* Empty state (discovery finished, no printers) */}
      {!state.isDiscovering && state.discovered.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 max-w-sm rounded border border-urgency/30 bg-urgency-surface p-4 text-center"
        >
          <p className="text-body-sm font-medium text-urgency">
            {t(
              'printing.wizard.discovery.no_printers',
              'No se encontraron impresoras',
            )}
          </p>
          <p className="mt-1 text-caption text-gray-500">
            {t(
              'printing.wizard.discovery.troubleshoot',
              'Verifique que la impresora esté encendida y conectada. Active la búsqueda en red si usa una impresora de red.',
            )}
          </p>
        </motion.div>
      )}
    </motion.div>
  );
};
