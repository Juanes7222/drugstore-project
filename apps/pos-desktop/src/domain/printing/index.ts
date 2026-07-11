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

// Proactive notifications
export { checkPrinterNotifications, PRINTER_NOTIFICATION_RULES } from './proactive-notifications';
export type { PrinterNotification, PrinterNotificationRule } from './proactive-notifications';

// Cash drawer and customer display
export { createCashDrawerService } from './cash-drawer.service';
export type { CashDrawerService } from './cash-drawer.service';

export { createCustomerDisplayService } from './customer-display.service';
export type { CustomerDisplayService } from './customer-display.service';

// Formatters
export { renderEscposReceipt, renderEscposTestPage, renderDrawerKickCommand } from './formatters/escpos-formatter';
export type { EscposRenderInput } from './formatters/escpos-formatter';

export { generatePdfHtml } from './formatters/pdf-formatter';
export type { PdfRenderInput } from './formatters/pdf-formatter';

export { generateLabelHtml, generateBatchLabelHtml } from './formatters/label-formatter';
export type { LabelRenderInput, LabelRenderBatchInput } from './formatters/label-formatter';

export { resolveTemplateVariables, resolveHeaderLines, resolveFooterLines, buildResolvedReceipt } from './formatters/template-engine';

// Utility
export { writePrintPayload } from './print-payload-writer';

// Exceptions
export * from './exceptions';
