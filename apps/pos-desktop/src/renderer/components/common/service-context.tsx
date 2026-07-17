/**
 * Service-context — React context + provider that exposes all domain services
 * to the component tree via hooks.
 *
 * ## Architecture
 *
 * The heavy lifting (PGlite init, factory wiring, Tauri IPC callbacks) lives
 * in `src/renderer/hooks/use-service-init.ts`.  This file is a thin
 * orchestrator that:
 *
 * 1. Calls `useServiceInit()` — a React hook wrapping the testable
 *    `initializeServices()` async function.
 * 2. Renders a loading spinner or error panel while initialising.
 * 3. Wraps children in `ServiceContext.Provider` with the resulting
 *    `Services` object.
 * 4. Exports convenience hooks so consumers never touch the
 *    context directly.
 *
 * ## Usage
 *
 * ```tsx
 * // At the app root (already done in App.tsx):
 * <ServiceProvider>
 *   <App />
 * </ServiceProvider>
 *
 * // In any screen / page component:
 * const returnsService = useReturnsService();
 * const adjustmentsService = useInventoryAdjustmentsService();
 * ```
 */

import {
  createContext,
  type FC,
  type ReactNode,
  useContext,
} from 'react';
import { useServiceInit } from '../../hooks/use-service-init';
import type { Services } from '../../hooks/use-service-init';
import { ServiceErrorPanel } from './service-error-panel';
import { ServiceLoading } from './service-loading';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Re-export the flat Services interface so consumers can reference it. */
export type { Services } from '../../hooks/use-service-init';

type InitState =
  | { status: 'loading' }
  | { status: 'ready'; services: Services }
  | { status: 'error'; error: Error };

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ServiceContext = createContext<Services | null>(null);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Read the full Services object from context.  Throws if called outside
 *  <ServiceProvider>.  Exported for advanced use cases such as starting the
 *  sync scheduler after login. */
export function useServiceContext(): Services {
  const ctx = useContext(ServiceContext);
  if (!ctx) {
    throw new Error(
      'useServiceContext() must be used inside a <ServiceProvider>.',
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Convenience hooks — one per service, stable names to match existing imports
// ---------------------------------------------------------------------------

/** Convenience hook — returns the ReturnsService instance. */
export const useReturnsService = (): Services['returnsService'] =>
  useServiceContext().returnsService;

/** Convenience hook — returns the InventoryAdjustmentsService instance. */
export const useInventoryAdjustmentsService =
  (): Services['inventoryAdjustmentsService'] =>
    useServiceContext().inventoryAdjustmentsService;

/** Convenience hook — returns the PrescriptionsService instance. */
export const usePrescriptionsService = (): Services['prescriptionsService'] =>
  useServiceContext().prescriptionsService;

/** Convenience hook — returns the BackupService instance. */
export const useBackupService = (): Services['backupService'] =>
  useServiceContext().backupService;

/** Convenience hook — returns the RecoveryLogService instance. */
export const useRecoveryLogService = (): Services['recoveryLogService'] =>
  useServiceContext().recoveryLogService;

/** Convenience hook — returns the InvoiceService instance. */
export const useInvoiceService = (): Services['invoiceService'] =>
  useServiceContext().invoiceService;

/** Convenience hook — returns the ContingencyService instance. */
export const useContingencyService = (): Services['contingencyService'] =>
  useServiceContext().contingencyService;

/** Convenience hook — returns the FiscalNumberingService instance. */
export const useFiscalNumberingService = (): Services['fiscalNumberingService'] =>
  useServiceContext().fiscalNumberingService;

/** Convenience hook — returns the PrinterConfigService instance. */
export const usePrinterConfigService = (): Services['printerConfigService'] =>
  useServiceContext().printerConfigService;

/** Convenience hook — returns the PrintQueueService instance. */
export const usePrintQueueService = (): Services['printQueueService'] =>
  useServiceContext().printQueueService;

/** Convenience hook — returns the PrintRouter instance. */
export const usePrintRouter = (): Services['printRouter'] =>
  useServiceContext().printRouter;

/** Convenience hook — returns the PrinterHealthService instance. */
export const usePrinterHealthService = (): Services['printerHealthService'] =>
  useServiceContext().printerHealthService;

/** Convenience hook — returns the ConfigExportService instance. */
export const useConfigExportService = (): Services['configExportService'] =>
  useServiceContext().configExportService;

/** Convenience hook — returns the PrintingMetricsService instance. */
export const usePrintingMetricsService = (): Services['printingMetricsService'] =>
  useServiceContext().printingMetricsService;

/** Convenience hook — returns the CashDrawerService instance. */
export const useCashDrawerService = (): Services['cashDrawerService'] =>
  useServiceContext().cashDrawerService;

/** Convenience hook — returns the CustomerDisplayService instance. */
export const useCustomerDisplayService = (): Services['customerDisplayService'] =>
  useServiceContext().customerDisplayService;

/** Convenience hook — returns the UpdateService instance. */
export const useUpdateService = (): Services['updateService'] =>
  useServiceContext().updateService;

/** Convenience hook — returns the ClientsService instance. */
export const useClientsService = (): Services['clientsService'] =>
  useServiceContext().clientsService;

/** Convenience hook — returns the ProductService instance. */
export const useProductService = (): Services['productService'] =>
  useServiceContext().productService;

/** Convenience hook — returns the SyncScheduler instance. */
export const useSyncSchedulerService = (): Services['syncScheduler'] =>
  useServiceContext().syncScheduler;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface ServiceProviderProps {
  /** Server base URL for the AuthService login call. Falls back to env var. */
  apiBaseUrl?: string;
  children: ReactNode;
}

export const ServiceProvider: FC<ServiceProviderProps> = ({
  apiBaseUrl,
  children,
}) => {
  const initState: InitState = useServiceInit({ apiBaseUrl });

  // ---- Error state --------------------------------------------------------
  if (initState.status === 'error') {
    return <ServiceErrorPanel error={initState.error} />;
  }

  // ---- Loading state ------------------------------------------------------
  if (initState.status === 'loading') {
    return <ServiceLoading />;
  }

  // ---- Ready state --------------------------------------------------------
  return (
    <ServiceContext.Provider value={initState.services}>
      {children}
    </ServiceContext.Provider>
  );
};
