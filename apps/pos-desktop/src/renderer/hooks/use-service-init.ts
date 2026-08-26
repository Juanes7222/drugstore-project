/**
 * Service initialisation hook — orchestrates PGlite/Prisma startup, reads
 * the local session, instantiates all domain services via their factories,
 * and exposes the resulting Services object through React state.
 *
 * ## Architecture
 *
 * Two layers so testing is practical without React:
 *
 * 1. **`initializeServices()`** — a plain async function that performs all
 *    the I/O and returns the `Services` object (or throws). This is the
 *    unit-testable core.
 *
 * 2. **`useServiceInit()`** — a React hook that calls `initializeServices()`
 *    inside a `useEffect`, manages loading/error/ready state, and handles
 *    cancellation on unmount.
 *
 * ## Testing
 *
 * ```ts
 * const services = await initializeServices({
 *   getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
 *   apiBaseUrl: 'http://localhost:3000',
 *   checkTechKey: () => false,
 *   currentVersion: '1.0.0',
 *   getSession: () => ({ session: mockSession }),
 *   executePrint: mockExecutePrint,
 *   discoverPrinters: mockDiscoverPrinters,
 * });
 * expect(services.returnsService).toBeDefined();
 * ```
 */

import { useEffect, useState } from 'react';
import { getLocalDatabase } from '../../infrastructure/local-database';
import type { PrismaClient } from '@pharmacy/database/local';
import { API_BASE_URL, WORKSTATION_ID, HOST_IP, FRIENDLY_NAME, HUB_ELIGIBLE } from '../../infrastructure/config';
import { createAuthService } from '../../domain/auth/auth.service';
import { useLocalSessionStore } from '../../domain/auth/local-session.store';
import {
  isContingencyTechKeyPlaceholder,
  IS_DEV_MODE,
} from '../../config/fiscal';
import { createDbDevtools } from '../../infrastructure/local-database-devtools';
import { isOnline } from '../../common/is-online';

import { createFiscalServices } from '../../domain/fiscal/fiscal-service.factory';
import { createPrintingServices } from '../../domain/printing/printing-service.factory';
import { createPeripheralServices } from '../../domain/peripherals/peripheral-service.factory';
import { createLocalAdjustmentService } from '../../domain/fiscal/local-adjustment.service';
import { createDomainServices } from '../../domain/domain-services/domain-service.factory';
import { createBackupService } from '../../domain/backup/backup.service';
import { createUploadWorker } from '../../domain/backup/upload-worker';
import { createSyncScheduler, type SyncScheduler } from '../../domain/sync/sync-scheduler.service';
import { createLocalAuditWriter } from '../../domain/audit/local-audit-writer.service';
import { createUpdateService } from '../../domain/updates/update.service';
import type { UpdateService, UpdateServiceConfig } from '../../domain/updates/update.service';
import { createLocalSyncEngine } from '../../domain/local-sync/local-sync-engine.service';
import type { LocalSyncEngine } from '../../domain/local-sync/local-sync-engine.service';
import type { PrintPayloadType, DiscoveredPrinter } from '../../domain/printing/printing-types';
import type { ServerPrintConfig } from '../../domain/printing/print-router';

// ---------------------------------------------------------------------------
// Types imported for the Services interface — we flatten grouped services
// into the same flat shape that service-context.tsx historically exposes.
// ---------------------------------------------------------------------------

import type { ReturnsService } from '../../domain/returns/returns.service';
import type { InventoryAdjustmentsService } from '../../domain/inventory-adjustments/inventory-adjustments.service';
import type { PrescriptionsService } from '../../domain/prescriptions/prescriptions.service';
import { createCashShiftService, type CashShiftService } from '../../domain/cash-shift/cash-shift.service';
import type { SalesPosService } from '../../domain/sales-pos/sales-pos.service';
import { createSalesHistoryService } from '../../domain/sales-pos/sales-history.service';
import type { SalesHistoryService } from '../../domain/sales-pos/sales-history.service';
import { useCashShiftStore } from '../../domain/cash-shift/cash-shift.store';
import { useLocalSyncStore } from '../store/local-sync/local-sync.store';
import { createInventoryLotsService, type InventoryLotsService } from '../../domain/inventory-lots/inventory-lots.service';
import type { ProductService } from '../../domain/catalog/product.service';
import type { ClientsService } from '../../domain/clients/clients.service';
import type { ImportService } from '../../domain/data-import/import.service';
import type { CreditService } from '../../domain/clients/credit.service';
import type { SuppliersService } from '../../domain/purchases/suppliers.service';
import type { PurchaseOrdersService } from '../../domain/purchases/purchase-orders.service';
import type { PurchaseReceptionsService } from '../../domain/purchases/purchase-receptions.service';
import type { SupplierReturnsService } from '../../domain/purchases/supplier-returns.service';
import type { BackupService } from '../../domain/backup/backup.service';
import type { RecoveryLogService } from '../../domain/backup/recovery-log.service';
import type { LocalAdjustmentService } from '../../domain/fiscal/local-adjustment.service';
import type { InvoiceService } from '../../domain/fiscal/invoice.service';
import type { ContingencyService } from '../../domain/fiscal/contingency.service';
import type { FiscalNumberingService } from '../../domain/fiscal/numbering.service';
import type { FiscalScheduler } from '../../domain/fiscal/fiscal-scheduler.service';
import type { PrinterConfigService } from '../../domain/printing/printer-config.service';
import type { PrintQueueService } from '../../domain/printing/print-queue.service';
import type { PrintRouter } from '../../domain/printing/print-router';
import type { PrinterHealthService } from '../../domain/printing/printer-health.service';
import type { ConfigExportService } from '../../domain/printing/config-export.service';
import type { PrintingMetricsService } from '../../domain/printing/printing-metrics.service';
import type { CashDrawerService } from '../../domain/printing/cash-drawer.service';
import type { CustomerDisplayService } from '../../domain/printing/customer-display.service';
import { ReportExecutionService } from '../../domain/reports/report-execution.service';
import { ReportExportService } from '../../domain/reports/report-export.service';
import { ReportScheduler } from '../../domain/reports/report-scheduler.service';
import { ShiftCloseDocumentService } from '../../domain/reports/shift-close-document.service';
import { DataExportService } from '../../domain/export';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Flat Services interface matching the original service-context.tsx shape.
 * All 18 individual services are directly accessible.
 */
export interface Services {
  returnsService: ReturnsService;
  inventoryAdjustmentsService: InventoryAdjustmentsService;
  prescriptionsService: PrescriptionsService;
  cashShiftService: CashShiftService;
  salesPosService: SalesPosService;
  salesHistoryService: SalesHistoryService;
  inventoryLotsService: InventoryLotsService;
  productService: ProductService;
  clientsService: ClientsService;
  importService: ImportService;
  creditService: CreditService;
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
  cashDrawerService: CashDrawerService;
  customerDisplayService: CustomerDisplayService;
  syncScheduler: SyncScheduler;
  localSyncEngine: LocalSyncEngine;
  updateService: UpdateService;
  suppliersService: SuppliersService;
  purchaseOrdersService: PurchaseOrdersService;
  purchaseReceptionsService: PurchaseReceptionsService;
  supplierReturnsService: SupplierReturnsService;
  localAdjustmentService: LocalAdjustmentService;
  reportExecutionService: ReportExecutionService;
  reportExportService: ReportExportService;
  reportScheduler: ReportScheduler;
  shiftCloseDocumentService: ShiftCloseDocumentService;
  dataExportService: DataExportService;
}

export type InitState =
  | { status: 'loading' }
  | { status: 'ready'; services: Services }
  | { status: 'error'; error: Error };

/** Injected dependencies for `initializeServices()`. */
export interface InitializeServicesInput {
  getLocalDatabase?: typeof getLocalDatabase;
  apiBaseUrl?: string;
  checkTechKey?: () => boolean;
  currentVersion?: string;
  /** Override the workstation ID.  Falls back to the session's workstationId
   *  (populated after login), then to the VITE_WORKSTATION_ID env var
   *  (default "ws_principal" for local dev). */
  workstationId?: string;
  getSession?: () => { session: { userId: string; workstationId: string; accessToken: string } | null };
  executePrint?: (
    printerSystemName: string,
    payloadPath: string,
    payloadType: PrintPayloadType,
  ) => Promise<{ success: boolean; errorMessage?: string; paperOut?: boolean }>;
  discoverPrinters?: () => Promise<DiscoveredPrinter[]>;
  isOnline?: () => boolean;
}

export interface UseServiceInitOptions {
  apiBaseUrl?: string;
}

// ---------------------------------------------------------------------------
// Deduplication for fiscal warn (StrictMode double-mount)
// ---------------------------------------------------------------------------

/** Suppress duplicate fiscal dev-warn when two callers race. */
const fiscalWarnedWorkstations = new Set<string>();

// ---------------------------------------------------------------------------
// Initialiser (pure async — testable without React)
// ---------------------------------------------------------------------------

async function makeExecutePrint(): Promise<
  NonNullable<InitializeServicesInput['executePrint']>
> {
  const { invoke } = await import('@tauri-apps/api/core');
  return async (systemName, payloadPath, _payloadType) => {
    try {
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
  };
}

async function makeDiscoverPrinters(): Promise<
  NonNullable<InitializeServicesInput['discoverPrinters']>
> {
  const { invoke } = await import('@tauri-apps/api/core');
  return async () => {
    try {
      return await invoke<DiscoveredPrinter[]>('discover_printers');
    } catch {
      return [];
    }
  };
}

/**
 * Create all domain services from scratch.
 *
 * This is a plain async function — no React dependencies — so it can be
 * called directly in tests with mock injectables.
 */
export async function initializeServices(
  input: InitializeServicesInput = {},
): Promise<Services> {
  const {
    getLocalDatabase: getDb = getLocalDatabase,
    apiBaseUrl = API_BASE_URL,
    checkTechKey = isContingencyTechKeyPlaceholder,
    currentVersion = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '0.1.0',
    getSession = useLocalSessionStore.getState,
    workstationId: inputWorkstationId,
  } = input;

  // 1. Initialise the local database (PGlite + Prisma)
  const { client, prisma } = await getDb();
  const prismaClient = prisma as PrismaClient;

  // ---- Devtools: expose window.__db for browser console inspection --------
  // Only in Vite dev server; stripped from Tauri production builds by tree-shaking.
  if (IS_DEV_MODE) {
    const devtools = createDbDevtools(client, prisma);
    (window as unknown as Record<string, unknown>).__db = devtools;
    console.info(
      '[devtools] window.__db ready — try:',
      '\n  await __db.tables()       — list tables',
      '\n  await __db.counts()       — row counts',
      '\n  await __db.exportJSON()   — download all tables as JSON',
      '\n  await __db.query("SELECT * FROM \"Product\" LIMIT 5") — raw SQL',
      '\n  await __db.reset({ force: true }) — WIPE local DB & reload (refuses if unsynced ops exist)',
    );
  }

  // 2. Check contingency tech key
  if (checkTechKey()) {
    throw new Error(
      'La clave técnica de contingencia no ha sido configurada. ' +
      'Configure VITE_CONTINGENCY_TECH_KEY en el entorno antes de usar el POS.',
    );
  }

  // 3. Read session for workstationId
  const session = getSession().session ?? null;
  const workstationId = inputWorkstationId ?? session?.workstationId ?? WORKSTATION_ID;

  // Warn if the session has a different workstationId than the one we are
  // using — indicates a config mismatch or a user login from a different
  // terminal.  Fiscal services were created with the resolved workstationId
  // above; the session value will be reconciled after login in App.tsx.
  if (session?.workstationId && session.workstationId !== workstationId) {
    console.warn(
      `[use-service-init] Session workstationId (${session.workstationId}) differs ` +
      `from resolved workstationId (${workstationId}).  Fiscal counters may not match.`,
    );
  }

  // --- Local sync Tauri module initialisation -------------------------------
  // The Rust-side LocalSyncModules start empty (None) and must be configured
  // with workstation identity, network key, and IP before any Tauri command
  // (get_status, get_peers, get_current_hub) succeeds.  This call populates
  // the three lazy modules (mDNS, server, client).
  //
  // Wrapped in try/catch so that non-Tauri environments (tests, browser dev)
  // degrade gracefully — the polling loop in useLocalSync will stay inactive
  // because the store's isInitialized stays false.
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const { createLocalNetworkKeyService } = await import(
      '../services/local-sync/local-network-key.service'
    );

    const networkKeyService = createLocalNetworkKeyService();
    let localNetworkKey = await networkKeyService.getKey();
    if (!localNetworkKey) {
      localNetworkKey = await networkKeyService.generateKey();
    }

    await invoke('initialize_local_sync', {
      workstationId,
      friendlyName: FRIENDLY_NAME,
      hubEligible: HUB_ELIGIBLE,
      localNetworkKey,
      hostIp: HOST_IP,
      port: null, // Rust defaults to 49_500
    });
  } catch (err) {
    // Tauri invoke not available (test/browser) or already initialized.
    // The error is harmless — the store's isInitialized stays false until a
    // component successfully calls initialize() with real params.
    if (import.meta.env.DEV) {
      console.debug('[initializeServices] Local sync init unavailable:', err);
    }
  }

  // licenseId and accessToken are optional session fields not present on the
  // LocalSession type; cast to access them (same pattern as original code).
  const sessionExt = session as { licenseId?: string; accessToken?: string } | null;

  // 4. Create fiscal services (interdependent — created together)
  const fiscalServices = createFiscalServices({
    prisma: prismaClient,
    workstationId,
  });

  // 4a. Ensure fiscal counters exist for this workstation.
  //     In development mode, auto-initialize with safe defaults so devs are
  //     not blocked. In production, let the error propagate — the app must
  //     refuse to operate until a manager configures the DIAN-authorized
  //     numbering range.
  if (IS_DEV_MODE) {
    try {
      await fiscalServices.fiscalNumberingService.ensureCounters();
    } catch {
      if (!fiscalWarnedWorkstations.has(workstationId)) {
        fiscalWarnedWorkstations.add(workstationId);
        console.warn(
          '[use-service-init] Fiscal counters not initialized for workstation ' +
            `"${workstationId}". Auto-initializing with development defaults. ` +
            'A manager must configure the authorized DIAN numbering range for production use.',
        );
      }
      await fiscalServices.fiscalNumberingService.initializeCounters({
        workstationId,
        currentRegularNumber: 0,
        currentContingencyNumber: 0,
        resolutionPrefix: 'FE',
        contingencyPrefix: 'CONT',
        paddingLength: 8,
        authorizedStart: 1,
        authorizedEnd: 99999999,
      });
    }
  } else {
    // Production: fail loud and clear so the operator cannot accidentally
    // issue non-compliant documents.
    await fiscalServices.fiscalNumberingService.ensureCounters();
  }

  // Hydrate contingency store from DB
  await fiscalServices.contingencyService.hydrateStore();

  // 5. Create printing services
  const executePrint = input.executePrint ?? (await makeExecutePrint());
  const discoverPrinters = input.discoverPrinters ?? (await makeDiscoverPrinters());

  const serverPrintConfig: ServerPrintConfig = {
    baseUrl: apiBaseUrl,
    authToken: sessionExt?.accessToken,
  };

  const printingServices = createPrintingServices({
    prisma: prismaClient,
    serverPrintConfig,
    io: {
      executePrint,
      discoverPrinters,
      isOnline: input.isOnline ?? isOnline,
    },
  });

  // 6. Create peripheral services
  const peripheralServices = createPeripheralServices(
    printingServices.printerConfig,
  );

  // 7. Create backup service
  const backupService = createBackupService();

  // 7a. Wire the off-site upload worker. Lives in app data dir so it
  //     survives restarts; new backups are enqueued automatically and
  //     drained when the device is online.
  const uploadWorker = createUploadWorker({ backupService });
  backupService.setUploadWorker(uploadWorker);

  // 8. Create update service
  const licenseId = sessionExt?.licenseId ?? 'unknown';

  const updateServiceConfig: UpdateServiceConfig = {
    prisma: prismaClient,
    currentVersion,
    workstationId,
    licenseId,
    accessToken: sessionExt?.accessToken
      ? () => Promise.resolve(sessionExt.accessToken!)
      : undefined,
    backupService,
  };
  const updateService = createUpdateService(updateServiceConfig);

  // Hydrate the update store from the local DB
  await import('../../domain/updates/update.store').then((m) =>
    m.useUpdateStore.getState().hydrateFromDb(prismaClient),
  );

  // Start telemetry flush cycle
  updateService.startTelemetryFlush();

  // 9. Create inventory-lots service (needed by domain services below)
  const inventoryLotsService = createInventoryLotsService(prismaClient);

  // 9b. Create local audit writer (fire-and-forget — never throws)
  const auditWriter = createLocalAuditWriter(prismaClient);

  // 10. Create domain services
  const authService = createAuthService({ baseUrl: apiBaseUrl });
  const domainServices = createDomainServices({
    prisma: prismaClient,
    auth: authService,
    invoiceService: fiscalServices.invoiceService,
    printRouter: printingServices.printRouter,
    inventoryLotsService,
    auditWriter,
  });

  // 10b. Create local adjustment service (needed by cash-shift for operational totals)
  const localAdjustmentService = createLocalAdjustmentService(prismaClient, authService);

  // 10c. Create sales history service (depends on local adjustment service)
  const salesHistoryService = createSalesHistoryService({
    prisma: prismaClient,
    adjustmentService: localAdjustmentService,
  });

  // 9d. Create cash-shift service and hydrate the current shift store
  const cashShiftService = createCashShiftService(
    prismaClient,
    authService,
    localAdjustmentService,
    printingServices.printRouter,
    auditWriter,
  );
  await useCashShiftStore.getState().hydrateFromDb(prismaClient);

  // 10. Start printer health check loop
  printingServices.printerHealth.start();

  // 11. Create sync scheduler (not started yet — needs a valid accessToken
  //     from the session, which may not exist on first launch.  InnerApp
  //     will start it when the session becomes available.)
  const syncScheduler = createSyncScheduler({
    prisma: prismaClient,
    baseUrl: apiBaseUrl,
    config: { baseUrl: apiBaseUrl },
    catalog: { baseUrl: apiBaseUrl },
    lots: { baseUrl: apiBaseUrl },
    clients: { baseUrl: apiBaseUrl },
    accessToken: sessionExt?.accessToken ?? undefined,
    invoiceService: fiscalServices.invoiceService,
    auditWriter,
    productService: domainServices.productService,
  });

  // 11b. Create and start the LAN relay engine — the automatic half of
  //      local-network sync. It pushes un-relayed SyncQueue entries to the
  //      elected hub and adopts peers' operations, so cross-station
  //      replication happens without any operator action. Cycle outcomes
  //      are surfaced through the existing local-sync store.
  const localSyncEngine = createLocalSyncEngine({
    prisma: prismaClient,
    workstationId,
    onCycleResult: (result) => {
      useLocalSyncStore.getState().applyCycleResult(result);
    },
  });
  localSyncEngine.start();

  // Flatten into the services interface consumers expect
  return {
    returnsService: domainServices.returnsService,
    inventoryAdjustmentsService: domainServices.inventoryAdjustmentsService,
    prescriptionsService: domainServices.prescriptionsService,
    cashShiftService,
    salesPosService: domainServices.salesPosService,
    salesHistoryService,
    inventoryLotsService,
    productService: domainServices.productService,
    clientsService: domainServices.clientsService,
    importService: domainServices.importService,
    creditService: domainServices.creditService,
    backupService,
    recoveryLogService: domainServices.recoveryLogService,
    invoiceService: fiscalServices.invoiceService,
    contingencyService: fiscalServices.contingencyService,
    fiscalNumberingService: fiscalServices.fiscalNumberingService,
    fiscalScheduler: fiscalServices.fiscalScheduler,
    printerConfigService: printingServices.printerConfig,
    printQueueService: printingServices.printQueue,
    printRouter: printingServices.printRouter,
    syncScheduler,
    localSyncEngine,
    printerHealthService: printingServices.printerHealth,
    configExportService: printingServices.configExport,
    printingMetricsService: printingServices.printingMetrics,
    cashDrawerService: peripheralServices.cashDrawer,
    customerDisplayService: peripheralServices.customerDisplay,
    updateService,
    suppliersService: domainServices.suppliersService,
    purchaseOrdersService: domainServices.purchaseOrdersService,
    purchaseReceptionsService: domainServices.purchaseReceptionsService,
    supplierReturnsService: domainServices.supplierReturnsService,
    localAdjustmentService,
    reportExecutionService: new ReportExecutionService(prismaClient),
    reportExportService: new ReportExportService(),
    reportScheduler: new ReportScheduler(
      prismaClient,
      new ReportExecutionService(prismaClient),
      new ReportExportService(),
      () => {
        const state = useLocalSessionStore.getState();
        return state.session;
      },
    ),
    shiftCloseDocumentService: new ShiftCloseDocumentService(prismaClient),
    dataExportService: new DataExportService(),
  };
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * React hook that calls `initializeServices()` on mount and manages the
 * loading/error/ready state for the `ServiceProvider`.
 */
export function useServiceInit(options: UseServiceInitOptions = {}): InitState {
  const [initState, setInitState] = useState<InitState>({ status: 'loading' });
  const { apiBaseUrl } = options;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const services = await initializeServices({ apiBaseUrl });
        if (!cancelled) {
          setInitState({ status: 'ready', services });
        }
      } catch (err) {
        if (!cancelled) {
          const normalized = err instanceof Error ? err : new Error(String(err));
          // Log to console for debugging — this catch previously masked the
          // error from DevTools while displaying it on screen via ServiceErrorPanel.
          console.error('[use-service-init] Service initialization failed:', normalized);
          setInitState({ status: 'error', error: normalized });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  return initState;
}
