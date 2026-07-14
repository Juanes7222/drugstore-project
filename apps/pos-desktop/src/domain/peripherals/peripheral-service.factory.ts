/**
 * Peripheral service factory — creates cash drawer and customer display
 * services that depend on PrinterConfigService for discovering the
 * printer to which each peripheral is attached.
 *
 * Extracted from the monolithic service-context.tsx initialisation block so
 * that the creation logic can be unit-tested without mounting a React tree.
 */

import type { PrinterConfigService } from '../printing/printer-config.service';
import { createCashDrawerService } from '../printing/cash-drawer.service';
import type { CashDrawerService } from '../printing/cash-drawer.service';
import { createCustomerDisplayService } from '../printing/customer-display.service';
import type { CustomerDisplayService } from '../printing/customer-display.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeripheralServices {
  cashDrawer: CashDrawerService;
  customerDisplay: CustomerDisplayService;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create peripheral services that depend on PrinterConfigService.
 *
 * Both cash drawer and customer display are physically connected to a
 * printer's pass-through port, so they need printer config to locate
 * the right printer.
 */
export function createPeripheralServices(
  printerConfigService: PrinterConfigService,
): PeripheralServices {
  return {
    cashDrawer: createCashDrawerService(printerConfigService),
    customerDisplay: createCustomerDisplayService(printerConfigService),
  };
}
