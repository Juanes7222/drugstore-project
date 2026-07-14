/**
 * Printing service factory — creates the full set of interconnected printing
 * services from a PrismaClient and external I/O callbacks.
 *
 * Extracted from the monolithic service-context.tsx initialisation block so
 * that the creation logic can be unit-tested without mounting a React tree.
 *
 * The factory receives high-level callbacks for operations that require Tauri
 * IPC (print execution, printer discovery) so those can be mocked in tests.
 */

import type { PrismaClient } from '@pharmacy/database/local';
import { createPrinterConfigService } from './printer-config.service';
import type { PrinterConfigService } from './printer-config.service';
import { createPrintQueueService } from './print-queue.service';
import type { PrintQueueService } from './print-queue.service';
import { createPrintRouter } from './print-router';
import type { PrintRouter, ServerPrintConfig } from './print-router';
import { createPrinterHealthService } from './printer-health.service';
import type { PrinterHealthService } from './printer-health.service';
import { createConfigExportService } from './config-export.service';
import type { ConfigExportService } from './config-export.service';
import { createPrintingMetricsService } from './printing-metrics.service';
import type { PrintingMetricsService } from './printing-metrics.service';
import type { PrintPayloadType, DiscoveredPrinter } from './printing-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrintingServices {
  printerConfig: PrinterConfigService;
  printQueue: PrintQueueService;
  printRouter: PrintRouter;
  printerHealth: PrinterHealthService;
  configExport: ConfigExportService;
  printingMetrics: PrintingMetricsService;
}

/** External I/O callbacks that the factory needs but cannot provide itself. */
export interface PrintingIoCallbacks {
  /** Execute a print job on a physical printer via Tauri IPC. */
  executePrint: (
    printerSystemName: string,
    payloadPath: string,
    payloadType: PrintPayloadType,
  ) => Promise<{
    success: boolean;
    errorMessage?: string;
    paperOut?: boolean;
  }>;

  /** Discover printers available on the current workstation via Tauri IPC. */
  discoverPrinters: () => Promise<DiscoveredPrinter[]>;

  /** Optional online-status check. Defaults to always-online if omitted. */
  isOnline?: () => boolean;
}

export interface PrintingServiceFactoryInput {
  prisma: PrismaClient;
  serverPrintConfig?: ServerPrintConfig;
  io: PrintingIoCallbacks;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the full set of printing services.
 *
 * Services are created in dependency order:
 *   1. PrinterConfigService  (standalone)
 *   2. PrintQueueService     (depends on callback that resolves printers via
 *                            PrinterConfigService — circular dependency
 *                            resolved at creation time)
 *   3. PrintRouter           (depends on config + queue)
 *   4. PrinterHealthService  (depends on config + queue + online check)
 *   5. ConfigExportService   (depends on config + discover callback)
 *   6. PrintingMetricsService (standalone)
 */
export function createPrintingServices(
  input: PrintingServiceFactoryInput,
): PrintingServices {
  const { prisma, serverPrintConfig, io } = input;

  const printerConfig = createPrinterConfigService(prisma);

  const printQueue = createPrintQueueService(
    prisma,
    (jobType) => printerConfig.getPrinterForJobType(jobType),
    io.executePrint,
  );

  const printRouter = createPrintRouter(
    printerConfig,
    printQueue,
    serverPrintConfig,
  );

  const printerHealth = createPrinterHealthService(
    printerConfig,
    printQueue,
    io.isOnline ?? (() => true),
  );

  const configExport = createConfigExportService(
    printerConfig,
    io.discoverPrinters,
  );

  const printingMetrics = createPrintingMetricsService(prisma);

  return {
    printerConfig,
    printQueue,
    printRouter,
    printerHealth,
    configExport,
    printingMetrics,
  };
}
