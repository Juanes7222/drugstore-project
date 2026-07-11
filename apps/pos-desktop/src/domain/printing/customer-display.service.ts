/**
 * Customer display integration service.
 *
 * Manages a customer-facing display connected through a printer's
 * pass-through port (or standalone via USB/serial). The display shows:
 * - Welcome message when idle
 * - Line items and running total during a sale
 * - Change due after sale confirmation
 * - Thank you message after sale
 *
 * ## Content modes
 * - LINE_ITEMS: each scanned item appears with running total
 * - TOTAL_ONLY: only the running total is shown (minimal)
 * - TOTAL_AND_CHANGE: running total + change due at confirmation
 *
 * ## Error handling
 * Display update failures are logged but never block the sale flow.
 * If all display updates fail in a session, a single warning banner
 * is shown to the cashier.
 *
 * ## Character encoding
 * Some older displays only support CP437 or CP850. If the configured
 * encoding fails, the service falls back to ASCII transliteration.
 */

import type { PrinterConfigService } from './printer-config.service';
import {
  type CustomerDisplayConfig,
  type CustomerDisplayMode,
  type DisplayContent,
} from './printing-types';

export interface CustomerDisplayService {
  /**
   * Send content to the customer display connected to a printer.
   *
   * @param printerId  The printer that has the display connected.
   * @param content    The content to display.
   */
  updateDisplay(printerId: string, content: DisplayContent): Promise<void>;

  /**
   * Show the idle/sleep message when no sale is in progress.
   */
  showIdle(printerId: string): Promise<void>;

  /**
   * Show the welcome message when a new sale starts.
   */
  showWelcome(printerId: string): Promise<void>;

  /**
   * Show sale line items as they're scanned.
   * Adds each new item to the display with running total.
   */
  updateSaleItems(
    printerId: string,
    items: Array<{ name: string; qty: number; price: number }>,
    total: number,
  ): Promise<void>;

  /**
   * Show the change due after a sale is confirmed.
   */
  showChangeDue(
    printerId: string,
    changeDue: number,
    total: number,
  ): Promise<void>;

  /**
   * Show the "thank you" message after the sale completes.
   * Automatically returns to idle after a configurable delay.
   */
  showThankYou(printerId: string): Promise<void>;

  /**
   * Get the display configuration for a printer.
   */
  getConfig(printerId: string): Promise<CustomerDisplayConfig>;

  /**
   * Set the display configuration for a printer.
   */
  setConfig(printerId: string, config: CustomerDisplayConfig): Promise<void>;

  /**
   * Whether the display failed during the current session.
   * Reset on new sale start.
   */
  hasDisplayFailed(printerId: string): boolean;

  /**
   * Reset the failure flag (called when a new sale starts).
   */
  resetFailureFlag(printerId: string): void;
}

export const createCustomerDisplayService = (
  printerConfigService: PrinterConfigService,
): CustomerDisplayService => {
  return new CustomerDisplayServiceImpl(printerConfigService);
};

class CustomerDisplayServiceImpl implements CustomerDisplayService {
  /** Per-session display failure tracking. */
  private displayFailures = new Map<string, boolean>();
  /** Line items accumulated during the current sale. */
  private currentItems: string[] = [];

  constructor(
    private readonly printerConfigService: PrinterConfigService,
  ) {}

  async updateDisplay(printerId: string, content: DisplayContent): Promise<void> {
    try {
      const printer = await this.printerConfigService.getById(printerId);
      const config = this.parseDisplayConfig(printer.customerDisplayConfig);

      if (!config?.hasDisplay) {
        return; // No display configured, silent skip
      }

      const displayText = this.buildDisplayText(content, config);
      const encoded = this.encodeText(displayText, config.encoding);

      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('customer_display_update', {
        printerSystemName: printer.systemName,
        text: encoded,
        encoding: config.encoding,
      });

      // Clear the failure flag on successful update
      this.displayFailures.set(printerId, false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(`[CustomerDisplay] Update failed for printer ${printerId}:`, errorMessage);

      // Set the failure flag; the caller can check hasDisplayFailed()
      if (!this.displayFailures.get(printerId)) {
        this.displayFailures.set(printerId, true);
      }
    }
  }

  async showIdle(printerId: string): Promise<void> {
    const config = await this.getConfig(printerId);
    await this.updateDisplay(printerId, {
      message: config.idleMessage,
    });
    this.currentItems = [];
  }

  async showWelcome(printerId: string): Promise<void> {
    const config = await this.getConfig(printerId);
    this.currentItems = [];
    this.displayFailures.set(printerId, false);

    await this.updateDisplay(printerId, {
      message: config.welcomeMessage,
    });
  }

  async updateSaleItems(
    printerId: string,
    items: Array<{ name: string; qty: number; price: number }>,
    total: number,
  ): Promise<void> {
    const config = await this.getConfig(printerId);

    if (config.mode === 'TOTAL_ONLY') {
      await this.updateDisplay(printerId, {
        total: this.formatPrice(total),
      });
      return;
    }

    // Build line items for display
    const lineItems = items.map(
      (item) => `${item.qty}x ${this.truncate(item.name, 15)} ${this.formatPrice(item.price)}`,
    );
    this.currentItems = lineItems;

    const displayContent: DisplayContent = {
      lineItems,
      total: this.formatPrice(total),
    };

    await this.updateDisplay(printerId, displayContent);
  }

  async showChangeDue(
    printerId: string,
    changeDue: number,
    total: number,
  ): Promise<void> {
    const config = await this.getConfig(printerId);

    if (config.mode === 'TOTAL_ONLY') {
      await this.updateDisplay(printerId, {
        message: `Total: ${this.formatPrice(total)}`,
      });
      return;
    }

    const content: DisplayContent = {
      total: this.formatPrice(total),
    };

    if (changeDue > 0) {
      content.changeDue = this.formatPrice(changeDue);
      content.message = `Cambio: ${this.formatPrice(changeDue)}`;
    } else {
      content.message = 'Pago exacto';
    }

    await this.updateDisplay(printerId, content);
  }

  async showThankYou(printerId: string): Promise<void> {
    const config = await this.getConfig(printerId);

    await this.updateDisplay(printerId, {
      message: config.thankYouMessage,
    });

    // After a delay, return to idle
    setTimeout(() => {
      this.showIdle(printerId).catch(() => {
        // Non-critical
      });
    }, 5_000);
  }

  async getConfig(printerId: string): Promise<CustomerDisplayConfig> {
    const printer = await this.printerConfigService.getById(printerId);
    return this.parseDisplayConfig(printer.customerDisplayConfig);
  }

  async setConfig(printerId: string, config: CustomerDisplayConfig): Promise<void> {
    const json = JSON.stringify(config);
    await this.updateCustomerDisplayConfig(printerId, json);
  }

  hasDisplayFailed(printerId: string): boolean {
    return this.displayFailures.get(printerId) ?? false;
  }

  resetFailureFlag(printerId: string): void {
    this.displayFailures.set(printerId, false);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async updateCustomerDisplayConfig(
    printerId: string,
    json: string,
  ): Promise<void> {
    try {
      const { getLocalDatabase } = await import('../../infrastructure/local-database');
      const { prisma } = await getLocalDatabase();
      const client = prisma as any;
      await client.printerConfig.update({
        where: { id: printerId },
        data: { customerDisplayConfig: json } as any,
      });
    } catch {
      console.warn('[CustomerDisplay] Could not update display config directly');
    }
  }

  private buildDisplayText(
    content: DisplayContent,
    _config: CustomerDisplayConfig,
  ): string {
    const lines: string[] = [];

    if (content.message) {
      lines.push(content.message);
      lines.push('');
    }

    if (content.lineItems && content.lineItems.length > 0) {
      // Show up to the last 8 items (display screens are small)
      const displayLines = content.lineItems.slice(-8);
      lines.push(...displayLines);
      lines.push('');
    }

    if (content.total) {
      lines.push(`TOTAL: ${content.total}`);
    }

    if (content.changeDue) {
      lines.push(`CAMBIO: ${content.changeDue}`);
    }

    return lines.join('\n');
  }

  private encodeText(text: string, _encoding: string): string {
    // For CP437/CP850, transliterate accented characters to ASCII
    // if the display doesn't support extended characters
    const transliterated = text
      .replace(/[áàâãäå]/g, 'a')
      .replace(/[éèêë]/g, 'e')
      .replace(/[íìîï]/g, 'i')
      .replace(/[óòôõö]/g, 'o')
      .replace(/[úùûü]/g, 'u')
      .replace(/[ñ]/g, 'n')
      .replace(/[Ñ]/g, 'N')
      .replace(/[¿]/g, '')
      .replace(/[¡]/g, '')
      .replace(/[°]/g, '');

    return transliterated;
  }

  private formatPrice(value: number): string {
    return value.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  private truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 1) + '…';
  }

  private parseDisplayConfig(configJson: string | null): CustomerDisplayConfig {
    if (!configJson) {
      return {
        hasDisplay: false,
        mode: 'TOTAL_ONLY',
        welcomeMessage: 'Bienvenido',
        thankYouMessage: 'Gracias por su compra',
        idleMessage: 'Bienvenido a Farmacia POS',
        encoding: 'CP850',
      };
    }

    try {
      return JSON.parse(configJson) as CustomerDisplayConfig;
    } catch {
      return {
        hasDisplay: false,
        mode: 'TOTAL_ONLY',
        welcomeMessage: 'Bienvenido',
        thankYouMessage: 'Gracias por su compra',
        idleMessage: 'Bienvenido a Farmacia POS',
        encoding: 'CP850',
      };
    }
  }
}
