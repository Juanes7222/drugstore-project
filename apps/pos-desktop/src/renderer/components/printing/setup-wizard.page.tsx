/**
 * Printer setup wizard page container.
 *
 * Guides the user through 7 steps:
 * 1. Welcome
 * 2. Discovery
 * 3. Found printers (card grid)
 * 4. Job assignment
 * 5. Test prints
 * 6. Fallback configuration
 * 7. Summary
 *
 * Wiring container — presentational sub-components are imported from index.ts.
 */

import { type FC, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { usePrinterConfigService } from '../common/service-context';
import type { DiscoveredPrinter } from '../../../domain/printing';
import {
  SetupWizardStepWelcome,
  SetupWizardStepDiscovery,
  SetupWizardStepFoundPrinters,
  SetupWizardStepJobAssignment,
  SetupWizardStepTestPrints,
  SetupWizardStepFallbackConfig,
  SetupWizardStepSummary,
} from './index';

export type WizardStep =
  | 'welcome'
  | 'discovery'
  | 'found-printers'
  | 'job-assignment'
  | 'test-prints'
  | 'fallback-config'
  | 'summary';

/** State shared between wizard steps. */
export interface WizardState {
  /** Current step. */
  step: WizardStep;
  /** Printers discovered on this workstation. */
  discovered: DiscoveredPrinter[];
  /** Printers the user selected to configure. */
  selected: DiscoveredPrinter[];
  /** Friendly names assigned by the user. */
  friendlyNames: Record<string, string>;
  /** Paper sizes per printer (auto-detected, overridable). */
  paperSizes: Record<string, string>;
  /** Job type assignments per printer (indexed by systemName). */
  jobAssignments: Record<string, string[]>;
  /** Fallback printer ID per printer config ID. */
  fallbackConfig: Record<string, { fallbackPrinterId: string | null; serverFallback: boolean }>;
  /** Test print results. */
  testResults: Record<string, boolean | null>;
  /** Whether discovery is still running. */
  isDiscovering: boolean;
  /** Whether the network scan is enabled. */
  networkScanEnabled: boolean;
}

const INITIAL_STATE: WizardState = {
  step: 'welcome',
  discovered: [],
  selected: [],
  friendlyNames: {},
  paperSizes: {},
  jobAssignments: {},
  fallbackConfig: {},
  testResults: {},
  isDiscovering: false,
  networkScanEnabled: false,
};

/** Ordered steps for navigation. */
const STEPS: WizardStep[] = [
  'welcome', 'discovery', 'found-printers', 'job-assignment',
  'test-prints', 'fallback-config', 'summary',
];

// ---------------------------------------------------------------------------
// Setup wizard page
// ---------------------------------------------------------------------------

export const SetupWizardPage: FC<{
  onComplete?: () => void;
  onDismiss?: () => void;
}> = ({ onComplete, onDismiss }) => {
  const { t } = useTranslation();
  const printerConfigService = usePrinterConfigService();

  const [state, setState] = useState<WizardState>(INITIAL_STATE);

  const currentStepIndex = STEPS.indexOf(state.step);

  const goToStep = useCallback((step: WizardStep) => {
    setState((prev) => ({ ...prev, step }));
  }, []);

  const saveAndComplete = useCallback(async () => {
    await saveConfiguration(state, printerConfigService);
    onComplete?.();
  }, [state, printerConfigService, onComplete]);

  return (
    <section
      aria-label={t('printing.wizard.title', 'Configurar impresoras')}
      className="flex h-full flex-col"
    >
      {/* Step indicator */}
      <div className="flex items-center gap-2 border-b px-6 py-4">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`flex items-center gap-1 text-sm ${
              state.step === s ? 'font-bold text-blue-600' : 'text-gray-400'
            }`}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full border text-xs">
              {i + 1}
            </span>
            <span className="hidden sm:inline">
              {t(`printing.wizard.step.${s}`, s.replace('-', ' '))}
            </span>
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto p-6">
        {state.step === 'welcome' && (
          <SetupWizardStepWelcome
            onStart={() => {
              setState((prev) => ({ ...prev, step: 'discovery', isDiscovering: true }));
              discoverPrinters(setState);
            }}
          />
        )}
        {state.step === 'discovery' && (
          <SetupWizardStepDiscovery state={state} setState={setState} />
        )}
        {state.step === 'found-printers' && (
          <SetupWizardStepFoundPrinters state={state} setState={setState} />
        )}
        {state.step === 'job-assignment' && (
          <SetupWizardStepJobAssignment state={state} setState={setState} />
        )}
        {state.step === 'test-prints' && (
          <SetupWizardStepTestPrints
            state={state}
            setState={setState}
            onTestPrint={async (systemName, _printerType: string) => {
              setState((prev) => ({ ...prev, testResults: { ...prev.testResults, [systemName]: null } }));
              try {
                const { invoke } = await import('@tauri-apps/api/core');
                const result = await invoke<{ success: boolean }>('test_print', {
                  printerSystemName: systemName,
                  payloadType: 'ESC_POS',
                });
                setState((prev) => ({ ...prev, testResults: { ...prev.testResults, [systemName]: result.success } }));
                return result;
              } catch (err) {
                setState((prev) => ({ ...prev, testResults: { ...prev.testResults, [systemName]: false } }));
                return { success: false, errorMessage: err instanceof Error ? err.message : String(err) };
              }
            }}
          />
        )}
        {state.step === 'fallback-config' && (
          <SetupWizardStepFallbackConfig state={state} setState={setState} />
        )}
        {state.step === 'summary' && (
          <SetupWizardStepSummary state={state} onComplete={saveAndComplete} />
        )}
      </div>

      {/* Navigation footer */}
      <div className="flex items-center justify-between border-t px-6 py-4">
        <button
          type="button"
          className="text-sm text-gray-500 hover:text-gray-700"
          onClick={() => {
            if (state.step === 'welcome') onDismiss?.();
            else goToStep(STEPS[currentStepIndex - 1]);
          }}
        >
          {state.step === 'welcome'
            ? t('printing.wizard.later', 'Configurar más tarde')
            : t('common.back', 'Atrás')}
        </button>

        {state.step !== 'summary' && state.step !== 'test-prints' && (
          <button
            type="button"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => goToStep(STEPS[currentStepIndex + 1])}
          >
            {state.step === 'welcome'
              ? t('printing.wizard.start', 'Empezar')
              : t('common.continue', 'Continuar')}
          </button>
        )}
        {state.step === 'test-prints' && (
          <button
            type="button"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => goToStep('fallback-config')}
          >
            {t('printing.wizard.continue', 'Continuar configuración')}
          </button>
        )}
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------

async function discoverPrinters(
  setState: React.Dispatch<React.SetStateAction<WizardState>>,
): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const printers = await invoke<DiscoveredPrinter[]>('discover_printers');
    // Populate paper sizes from auto-detection (user can override later)
    const initialPaperSizes: Record<string, string> = {};
    for (const p of printers) {
      if (p.detectedPaperSize && p.detectedPaperSize !== 'UNKNOWN') {
        initialPaperSizes[p.systemName] = p.detectedPaperSize;
      }
    }
    setState((prev) => ({
      ...prev,
      discovered: printers,
      paperSizes: { ...prev.paperSizes, ...initialPaperSizes },
      isDiscovering: false,
    }));
  } catch {
    setState((prev) => ({ ...prev, isDiscovering: false }));
  }
}

async function saveConfiguration(
  state: WizardState,
  printerConfigService: ReturnType<typeof usePrinterConfigService>,
): Promise<void> {
  for (const printer of state.selected) {
    await printerConfigService.create({
      friendlyName: state.friendlyNames[printer.systemName] || printer.friendlyName,
      systemName: printer.systemName,
      printerType: printer.printerType as any,
      connection: printer.connection as any,
      paperSize: (state.paperSizes[printer.systemName] || 'RECEIPT_80MM') as any,
      supportsColor: printer.supportsColor,
      assignedJobs: state.jobAssignments[printer.systemName] ?? [],
      fallbackPrinterId: null,
      serverFallbackEnabled: state.fallbackConfig[printer.systemName]?.serverFallback ?? false,
    });
  }

  // Second pass: set up fallback chains
  const allPrinters = await printerConfigService.listAll();
  for (const printer of state.selected) {
    const saved = allPrinters.find((p) => p.systemName === printer.systemName);
    if (!saved) continue;

    const fallback = state.fallbackConfig[printer.systemName];
    if (fallback?.fallbackPrinterId) {
      const fallbackSaved = allPrinters.find(
        (p) => p.systemName === fallback.fallbackPrinterId,
      );
      if (fallbackSaved) {
        await printerConfigService.setFallbackChain(
          saved.id,
          fallbackSaved.id,
          fallback.serverFallback,
        );
      }
    }
  }
}
