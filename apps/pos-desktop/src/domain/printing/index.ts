/**
 * Printing subsystem — barrel exports.
 *
 * Exporting only what other modules and the UI layer are meant to consume.
 * Internal helpers stay unexported.
 */

export { createPrinterConfigService } from './printer-config.service';
export type { PrinterConfigService } from './printer-config.service';

export { createPrintQueueService } from './print-queue.service';
export type { PrintQueueService } from './print-queue.service';

export { createPrintRouter } from './print-router';
export type { PrintRouter, PrintInput, ServerPrintConfig } from './print-router';

export { createPrinterHealthService } from './printer-health.service';
export type { PrinterHealthService, HealthCheckReport } from './printer-health.service';

export { createConfigExportService } from './config-export.service';
export type { ConfigExportService } from './config-export.service';

export { createPrintingMetricsService } from './printing-metrics.service';
export type { PrintingMetricsService } from './printing-metrics.service';

// Types
export * from './printing-types';

// Utility
export { writePrintPayload } from './print-payload-writer';

// Exceptions
export * from './exceptions';
