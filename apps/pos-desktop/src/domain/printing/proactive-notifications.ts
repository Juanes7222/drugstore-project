/**
 * Proactive notification rules for the printing subsystem.
 *
 * Each rule defines a condition that the assistant's suggestion engine
 * checks periodically. When a condition is met, the assistant surfaces
 * a notification with a suggested action.
 *
 * These rules are loaded by the assistant/suggestion engine and checked
 * against the current printing state.
 */

import type { PrinterConfigService } from './printer-config.service';
import type { PrintQueueService } from './print-queue.service';
import type { CashDrawerService } from './cash-drawer.service';
import type { PrinterStatusCode } from './printing-types';

export interface PrinterNotificationRule {
  id: string;
  label: string;
  /** Suggested i18n key for the notification message. */
  messageKey: string;
  /** Suggested action label. */
  actionKey: string;
  /** The command to invoke when the action is triggered. */
  actionCommand: string;
  /** Whether this notification requires manager role. */
  requiresManager: boolean;
}

export interface PrinterNotification {
  ruleId: string;
  message: string;
  action: string;
  actionCommand: string;
  severity: 'info' | 'warning' | 'error';
  printerName?: string;
}

/**
 * Check all printing-related notification rules and return active notifications.
 *
 * @param printerConfigService The printer config service.
 * @param printQueueService    The print queue service.
 * @param cashDrawerService    The cash drawer service.
 * @returns                    An array of active notifications.
 */
export async function checkPrinterNotifications(
  printerConfigService: PrinterConfigService,
  printQueueService: PrintQueueService,
  cashDrawerService: CashDrawerService,
): Promise<PrinterNotification[]> {
  const notifications: PrinterNotification[] = [];
  const printers = await printerConfigService.listAll();

  // Rule 1: Printer offline/error detection
  for (const printer of printers) {
    if (printer.status === 'OFFLINE' || printer.status === 'ERROR') {
      notifications.push({
        ruleId: 'printer-offline',
        message: `"${printer.friendlyName}" dejó de responder`,
        action: 'Diagnosticar',
        actionCommand: 'cmd.diagnose-printer',
        severity: 'error',
        printerName: printer.friendlyName,
      });
    }

    // Rule 2: No paper
    if (printer.status === 'NO_PAPER') {
      notifications.push({
        ruleId: 'printer-no-paper',
        message: `Cambia el papel de "${printer.friendlyName}"`,
        action: 'Marcar como resuelto',
        actionCommand: 'cmd.mark-printer-resolved',
        severity: 'warning',
        printerName: printer.friendlyName,
      });
    }
  }

  // Rule 3: Pending print jobs
  const queueSummary = await printQueueService.getQueueSummary();
  if (queueSummary.pending > 0) {
    const printerInfo =
      queueSummary.pending === 1
        ? '1 trabajo en cola de impresión'
        : `${queueSummary.pending} trabajos en cola de impresión`;

    notifications.push({
      ruleId: 'print-queue-pending',
      message: printerInfo,
      action: 'Ver cola',
      actionCommand: 'cmd.view-print-queue',
      severity: 'warning',
    });
  }

  // Rule 4: Failed jobs
  if (queueSummary.failed > 0) {
    notifications.push({
      ruleId: 'print-queue-failed',
      message: `${queueSummary.failed} trabajo(s) de impresión fallaron`,
      action: 'Reintentar fallidos',
      actionCommand: 'cmd.retry-print-queue',
      severity: 'error',
    });
  }

  // Rule 5: Cash drawer issues (simplified - check last failed open)
  // In a real implementation, this would check recent drawer open failures
  // from the audit trail. Placeholder for now.
  for (const printer of printers) {
    if (printer.cashDrawerConfig) {
      try {
        const config = JSON.parse(printer.cashDrawerConfig);
        if (config.hasDrawer) {
          // Check if any recent sale had a failed drawer open for this printer
          // This requires querying the audit log, which is not yet implemented.
          // Placeholder logic:
          if (printer.status === 'ERROR' || printer.status === 'OFFLINE') {
            notifications.push({
              ruleId: 'cash-drawer-possible-issue',
              message: `El cajón de "${printer.friendlyName}" podría no abrirse (impresora ${printer.status.toLowerCase()})`,
              action: 'Revisar impresora',
              actionCommand: 'cmd.printer-status',
              severity: 'warning',
              printerName: printer.friendlyName,
            });
          }
        }
      } catch {
        // Invalid JSON, skip
      }
    }
  }

  // Rule 6: No printers configured at first launch
  if (printers.length === 0) {
    notifications.push({
      ruleId: 'no-printers-configured',
      message: 'No hay impresoras configuradas',
      action: 'Configurar',
      actionCommand: 'cmd.configure-printers',
      severity: 'warning',
    });
  }

  return notifications;
}

/**
 * List of available printer notification rules for reference.
 */
export const PRINTER_NOTIFICATION_RULES: PrinterNotificationRule[] = [
  {
    id: 'printer-offline',
    label: 'Impresora fuera de línea',
    messageKey: 'notifications.printerOffline',
    actionKey: 'notifications.diagnose',
    actionCommand: 'cmd.diagnose-printer',
    requiresManager: false,
  },
  {
    id: 'printer-no-paper',
    label: 'Impresora sin papel',
    messageKey: 'notifications.printerNoPaper',
    actionKey: 'notifications.markResolved',
    actionCommand: 'cmd.mark-printer-resolved',
    requiresManager: false,
  },
  {
    id: 'print-queue-pending',
    label: 'Trabajos pendientes en cola',
    messageKey: 'notifications.printQueuePending',
    actionKey: 'notifications.viewQueue',
    actionCommand: 'cmd.view-print-queue',
    requiresManager: false,
  },
  {
    id: 'print-queue-failed',
    label: 'Trabajos fallidos en cola',
    messageKey: 'notifications.printQueueFailed',
    actionKey: 'notifications.retryFailed',
    actionCommand: 'cmd.retry-print-queue',
    requiresManager: true,
  },
  {
    id: 'cash-drawer-possible-issue',
    label: 'Posible problema con cajón monedero',
    messageKey: 'notifications.cashDrawerIssue',
    actionKey: 'notifications.checkPrinter',
    actionCommand: 'cmd.printer-status',
    requiresManager: false,
  },
  {
    id: 'no-printers-configured',
    label: 'Sin impresoras configuradas',
    messageKey: 'notifications.noPrinters',
    actionKey: 'notifications.configurePrinters',
    actionCommand: 'cmd.configure-printers',
    requiresManager: true,
  },
];
