/**
 * Printing-related command palette commands.
 *
 * These commands are registered with the command palette system
 * and made available to the cashier through Ctrl+K / F1.
 *
 * Each command has an id, label, category, and an optional
 * execute callback or navigation target.
 */

export interface PaletteCommand {
  id: string;
  label: string;
  /** Spanish label for the command palette display. */
  labelEs: string;
  category: 'printing' | 'general';
  /** Keyboard shortcut hint (optional). */
  shortcut?: string;
  /**
   * Navigation route or action.
   * - 'route:#/path' to navigate to a hash route
   * - 'action:name' to trigger a named action
   */
  action: string;
  /** Role-based access: which role can see this command. */
  minRole?: 'cashier' | 'manager' | 'admin';
}

export const PRINTING_COMMANDS: PaletteCommand[] = [
  // --- Configuration ---
  {
    id: 'cmd.configure-printers',
    label: 'Configure printers',
    labelEs: 'Configurar impresoras',
    category: 'printing',
    action: 'route:#/printing/setup',
    minRole: 'manager',
  },
  {
    id: 'cmd.edit-printer',
    label: 'Edit printer configuration',
    labelEs: 'Editar configuración de impresora',
    category: 'printing',
    action: 'route:#/printing/printers',
    minRole: 'manager',
  },
  {
    id: 'cmd.test-printer',
    label: 'Test a printer',
    labelEs: 'Probar una impresora',
    category: 'printing',
    action: 'action:test-printer-select',
    minRole: 'manager',
  },
  {
    id: 'cmd.test-all-printers',
    label: 'Test all printers',
    labelEs: 'Probar todas las impresoras',
    category: 'printing',
    action: 'action:test-all-printers',
    minRole: 'manager',
  },

  // --- Queue management ---
  {
    id: 'cmd.view-print-queue',
    label: 'View print queue',
    labelEs: 'Ver cola de impresión',
    category: 'printing',
    action: 'route:#/printing/queue',
    minRole: 'cashier',
  },
  {
    id: 'cmd.retry-print-queue',
    label: 'Retry all pending print jobs',
    labelEs: 'Reintentar trabajos pendientes',
    category: 'printing',
    action: 'action:retry-all-pending',
    minRole: 'manager',
  },
  {
    id: 'cmd.discard-failed-jobs',
    label: 'Discard all failed print jobs',
    labelEs: 'Descartar trabajos fallidos',
    category: 'printing',
    action: 'action:discard-failed-jobs',
    minRole: 'manager',
  },

  // --- Status ---
  {
    id: 'cmd.printer-status',
    label: 'View printer status',
    labelEs: 'Ver estado de impresoras',
    category: 'printing',
    action: 'route:#/printing/printers',
    minRole: 'cashier',
  },

  // --- Peripherals ---
  {
    id: 'cmd.open-cash-drawer',
    label: 'Open cash drawer',
    labelEs: 'Abrir cajón monedero',
    category: 'printing',
    action: 'action:open-cash-drawer',
    minRole: 'cashier',
  },
  {
    id: 'cmd.test-customer-display',
    label: 'Test customer display',
    labelEs: 'Probar pantalla del cliente',
    category: 'printing',
    action: 'action:test-customer-display',
    minRole: 'manager',
  },

  // --- Help ---
  {
    id: 'cmd.help-printing-setup',
    label: 'Help: Printer setup',
    labelEs: 'Ayuda: Configurar impresoras',
    category: 'printing',
    action: 'action:show-help:printing/setup-wizard',
    minRole: 'cashier',
  },
  {
    id: 'cmd.help-printing-troubleshooting',
    label: 'Help: Printer troubleshooting',
    labelEs: 'Ayuda: Solucionar problemas de impresión',
    category: 'printing',
    action: 'action:show-help:printing/troubleshooting',
    minRole: 'cashier',
  },
  {
    id: 'cmd.help-printing-cash-drawer',
    label: 'Help: Cash drawer',
    labelEs: 'Ayuda: Cajón monedero',
    category: 'printing',
    action: 'action:show-help:printing/cash-drawer',
    minRole: 'cashier',
  },
  {
    id: 'cmd.help-printing-customer-display',
    label: 'Help: Customer display',
    labelEs: 'Ayuda: Pantalla del cliente',
    category: 'printing',
    action: 'action:show-help:printing/customer-display',
    minRole: 'cashier',
  },
  {
    id: 'cmd.help-printing-templates',
    label: 'Help: Receipt templates',
    labelEs: 'Ayuda: Plantillas de recibo',
    category: 'printing',
    action: 'action:show-help:printing/receipt-templates',
    minRole: 'cashier',
  },
  {
    id: 'cmd.help-printing-fallback',
    label: 'Help: Print fallback',
    labelEs: 'Ayuda: Respaldo de impresión',
    category: 'printing',
    action: 'action:show-help:printing/fallback',
    minRole: 'cashier',
  },
  {
    id: 'cmd.help-printing-sharing',
    label: 'Help: Share printer config',
    labelEs: 'Ayuda: Compartir configuración',
    category: 'printing',
    action: 'action:show-help:printing/sharing-printers',
    minRole: 'manager',
  },
];
