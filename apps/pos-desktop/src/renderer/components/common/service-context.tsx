/**
 * Service-context — React context + provider that instantiates the real
 * domain services from src/domain/ with the local PGlite PrismaClient and
 * AuthService, and makes them available via hooks anywhere in the component
 * tree.
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
 * const prescriptionsService = usePrescriptionsService();
 * ```
 *
 * ## Initialisation
 *
 * The provider mounts a loading spinner until PGlite + Prisma have finished
 * initialising.  In the unlikely event that initialisation fails, the provider
 * renders a fatal-error panel — the POS cannot operate without a local DB.
 */
import {
  createContext,
  type FC,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { getLocalDatabase } from "../../../infrastructure/local-database";
import { API_BASE_URL } from "@infra/config";
import { createReturnsService, ReturnsService } from "../../../domain/returns/returns.service";
import {
  createInventoryAdjustmentsService,
  InventoryAdjustmentsService,
} from "../../../domain/inventory-adjustments/inventory-adjustments.service";
import {
  createPrescriptionsService,
  PrescriptionsService,
} from "../../../domain/prescriptions/prescriptions.service";
import { createAuthService, AuthService } from "../../../domain/auth/auth.service";
import { createBackupService, BackupService } from "../../../domain/backup/backup.service";
import { createRecoveryLogService, RecoveryLogService } from "../../../domain/backup/recovery-log.service";
import { createInvoiceService, InvoiceService } from "../../../domain/fiscal/invoice.service";
import {
  createContingencyService,
  ContingencyService,
} from "../../../domain/fiscal/contingency.service";
import {
  createFiscalNumberingService,
  FiscalNumberingService,
} from "../../../domain/fiscal/numbering.service";
import {
  createFiscalScheduler,
  FiscalScheduler,
} from "../../../domain/fiscal/fiscal-scheduler.service";
import { isContingencyTechKeyPlaceholder } from "../../../config/fiscal";
import type { PrismaClient } from "@pharmacy/database/local";
import {
  createPrinterConfigService,
  type PrinterConfigService,
  createPrintQueueService,
  type PrintQueueService,
  createPrintRouter,
  type PrintRouter,
  createPrinterHealthService,
  type PrinterHealthService,
  createConfigExportService,
  type ConfigExportService,
  createPrintingMetricsService,
  type PrintingMetricsService,
} from "../../../domain/printing";
import { isOnline } from "../../../common/is-online";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Services {
  returnsService: ReturnsService;
  inventoryAdjustmentsService: InventoryAdjustmentsService;
  prescriptionsService: PrescriptionsService;
  backupService: BackupService;
  recoveryLogService: RecoveryLogService;
  invoiceService: InvoiceService;
  contingencyService: ContingencyService;
  fiscalNumberingService: FiscalNumberingService;
  fiscalScheduler: FiscalScheduler;
  printerConfigService: PrinterConfigService;
  printQueueService: PrintQueueService;
  printRouter: PrintRouter;
  printerHealthService: PrinterHealthService;
  configExportService: ConfigExportService;
  printingMetricsService: PrintingMetricsService;
}

type InitState =
  | { status: "loading" }
  | { status: "ready"; services: Services }
  | { status: "error"; error: Error };

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ServiceContext = createContext<Services | null>(null);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function useServiceContext(): Services {
  const ctx = useContext(ServiceContext);
  if (!ctx) {
    throw new Error(
      "useServiceContext() must be used inside a <ServiceProvider>.",
    );
  }
  return ctx;
}

/** Convenience hook — returns the ReturnsService instance. */
export const useReturnsService = (): ReturnsService =>
  useServiceContext().returnsService;

/** Convenience hook — returns the InventoryAdjustmentsService instance. */
export const useInventoryAdjustmentsService = (): InventoryAdjustmentsService =>
  useServiceContext().inventoryAdjustmentsService;

/** Convenience hook — returns the PrescriptionsService instance. */
export const usePrescriptionsService = (): PrescriptionsService =>
  useServiceContext().prescriptionsService;

/** Convenience hook — returns the BackupService instance. */
export const useBackupService = (): BackupService => useServiceContext().backupService;

/** Convenience hook — returns the RecoveryLogService instance. */
export const useRecoveryLogService = (): RecoveryLogService =>
  useServiceContext().recoveryLogService;

/** Convenience hook — returns the InvoiceService instance. */
export const useInvoiceService = (): InvoiceService =>
  useServiceContext().invoiceService;

/** Convenience hook — returns the ContingencyService instance. */
export const useContingencyService = (): ContingencyService =>
  useServiceContext().contingencyService;

/** Convenience hook — returns the FiscalNumberingService instance. */
export const useFiscalNumberingService = (): FiscalNumberingService =>
  useServiceContext().fiscalNumberingService;

/** Convenience hook — returns the PrinterConfigService instance. */
export const usePrinterConfigService = (): PrinterConfigService =>
  useServiceContext().printerConfigService;

/** Convenience hook — returns the PrintQueueService instance. */
export const usePrintQueueService = (): PrintQueueService =>
  useServiceContext().printQueueService;

/** Convenience hook — returns the PrintRouter instance. */
export const usePrintRouter = (): PrintRouter =>
  useServiceContext().printRouter;

/** Convenience hook — returns the PrinterHealthService instance. */
export const usePrinterHealthService = (): PrinterHealthService =>
  useServiceContext().printerHealthService;

/** Convenience hook — returns the ConfigExportService instance. */
export const useConfigExportService = (): ConfigExportService =>
  useServiceContext().configExportService;

/** Convenience hook — returns the PrintingMetricsService instance. */
export const usePrintingMetricsService = (): PrintingMetricsService =>
  useServiceContext().printingMetricsService;

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
  const { t } = useTranslation();
  const [initState, setInitState] = useState<InitState>({ status: "loading" });

  const baseUrl = apiBaseUrl ?? API_BASE_URL;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // 1. Initialise the local database (PGlite + Prisma)
        const { prisma } = await getLocalDatabase();

        if (cancelled) return;

        // 2. Check contingency tech key — refuse to operate if still placeholder
        if (isContingencyTechKeyPlaceholder()) {
          throw new Error(
            'La clave técnica de contingencia no ha sido configurada. ' +
            'Configure VITE_CONTINGENCY_TECH_KEY en el entorno antes de usar el POS.',
          );
        }

        // 3. Create AuthService (reads session from the Zustand store in memory)
        const auth: AuthService = createAuthService({ baseUrl });

        // 4. Create fiscal services
        const prismaClient = prisma as PrismaClient;
        const session = (await import('../../../domain/auth/local-session.store'))
          .useLocalSessionStore.getState().session;
        const workstationId = session?.workstationId ?? 'unknown';

        const fiscalNumberingService = createFiscalNumberingService({
          prisma: prismaClient,
          workstationId,
        });

        const contingencyService = createContingencyService({
          prisma: prismaClient,
          workstationId,
        });

        const invoiceService = createInvoiceService({
          prisma: prismaClient,
          workstationId,
          numberingService: fiscalNumberingService,
          contingencyService,
        });

        // Hydrate contingency store from DB
        await contingencyService.hydrateStore();

        const fiscalScheduler = createFiscalScheduler({
          invoiceService,
          contingencyService,
        });

        // 4a. Create printing services (use temp vars to avoid scope issues)
        const printerConfig = createPrinterConfigService(prismaClient);
        const printQueue = createPrintQueueService(
          prismaClient,
          async (jobType) => {
            try {
              return await printerConfig.getPrinterForJobType(jobType);
            } catch {
              return null;
            }
          },
          async (systemName, payloadPath, _payloadType) => {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const result = await invoke<{
                success: boolean;
                errorMessage?: string;
                paperOut?: boolean;
              }>('print_file', {
                printerSystemName: systemName,
                filePath: payloadPath,
              });
              return result;
            } catch (err) {
              return {
                success: false,
                errorMessage: err instanceof Error ? err.message : String(err),
                paperOut: false,
              };
            }
          },
        );
        const printRouter = createPrintRouter(
          printerConfig,
          printQueue,
          { baseUrl, authToken: undefined },
        );
        const printerHealth = createPrinterHealthService(
          printerConfig,
          printQueue,
          () => isOnline(),
        );
        const configExport = createConfigExportService(
          printerConfig,
          async () => {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const discovered = await invoke<Array<{
                systemName: string;
                friendlyName: string;
                connection: string;
                isDefault: boolean;
                printerType: string;
                supportsColor: boolean;
              }>>('discover_printers');
              return discovered;
            } catch {
              return [];
            }
          },
        );
        const printingMetrics = createPrintingMetricsService(prismaClient);

        // 4b. Create domain services (with fiscal service wired in)
        const services: Services = {
          returnsService: createReturnsService(prismaClient, auth, invoiceService, printRouter),
          inventoryAdjustmentsService: createInventoryAdjustmentsService(prismaClient, auth),
          prescriptionsService: createPrescriptionsService(prismaClient, auth),
          backupService: createBackupService(),
          recoveryLogService: createRecoveryLogService(prismaClient),
          invoiceService,
          contingencyService,
          fiscalNumberingService,
          fiscalScheduler,
          printerConfigService: printerConfig,
          printQueueService: printQueue,
          printRouter,
          printerHealthService: printerHealth,
          configExportService: configExport,
          printingMetricsService: printingMetrics,
        };

        // 5. Start the printer health check loop
        printerHealth.start();

        setInitState({ status: "ready", services });
      } catch (err) {
        if (!cancelled) {
          setInitState({
            status: "error",
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  // ---- Render -----------------------------------------------------------

  if (initState.status === "error") {
    return (
      <div
        className="flex h-screen flex-col items-center justify-center p-pos-xl"
        style={{ backgroundColor: "var(--color-surface)" }}
        role="alert"
      >
        <div className="pos-panel max-w-lg p-pos-xl text-center">
          <h1
            className="text-heading font-bold"
            style={{ color: "var(--color-urgency)" }}
          >
            {t("common.app_name")}
          </h1>
          <p
            className="mt-pos-md text-body"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 60%, transparent)",
            }}
          >
            {t("common.loading")}
          </p>
          <p className="mt-pos-sm font-data text-caption">
            {initState.error.message}
          </p>
        </div>
      </div>
    );
  }

  if (initState.status === "loading") {
    return (
      <div
        className="flex h-screen flex-col items-center justify-center"
        style={{ backgroundColor: "var(--color-surface)" }}
      >
        <div className="text-center">
          <div
            className="mx-auto mb-pos-md h-8 w-8 animate-spin rounded-full border-2 border-transparent"
            style={{
              borderTopColor: "var(--color-pharma)",
              borderRightColor: "var(--color-pharma)",
            }}
            aria-hidden="true"
          />
          <p
            className="text-body font-medium"
            style={{ color: "var(--color-ink)" }}
          >
            {t("common.loading")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ServiceContext.Provider value={initState.services}>
      {children}
    </ServiceContext.Provider>
  );
};
