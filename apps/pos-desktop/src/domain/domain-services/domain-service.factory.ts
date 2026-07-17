/**
 * Domain service factory — creates domain services that orchestrate business
 * operations (returns, inventory adjustments, prescriptions, recovery log).
 *
 * Extracted from the monolithic service-context.tsx initialisation block so
 * that the creation logic can be unit-tested without mounting a React tree.
 */

import type { PrismaClient } from '@pharmacy/database/local';
import type { AuthService } from '../auth/auth.service';
import type { InvoiceService } from '../fiscal/invoice.service';
import type { PrintRouter } from '../printing/print-router';
import { createReturnsService } from '../returns/returns.service';
import type { ReturnsService } from '../returns/returns.service';
import { createInventoryAdjustmentsService } from '../inventory-adjustments/inventory-adjustments.service';
import type { InventoryAdjustmentsService } from '../inventory-adjustments/inventory-adjustments.service';
import { createPrescriptionsService } from '../prescriptions/prescriptions.service';
import type { PrescriptionsService } from '../prescriptions/prescriptions.service';
import { createRecoveryLogService } from '../backup/recovery-log.service';
import type { RecoveryLogService } from '../backup/recovery-log.service';
import { createProductService } from '../catalog/product.service';
import type { ProductService } from '../catalog/product.service';
import { getTenantConfigState } from '../config/tenant-config.store';
import type { EffectiveConfig } from '../config/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DomainServices {
  returnsService: ReturnsService;
  inventoryAdjustmentsService: InventoryAdjustmentsService;
  prescriptionsService: PrescriptionsService;
  recoveryLogService: RecoveryLogService;
  productService: ProductService;
}

export interface DomainServiceFactoryInput {
  prisma: PrismaClient;
  auth: AuthService;
  invoiceService?: InvoiceService;
  printRouter?: PrintRouter;
}

/**
 * Get the current effective tenant config.
 *
 * Services that need to check field requirements or workflow preferences
 * call this function rather than importing the store directly.
 * Returns null if no config has been loaded yet.
 */
export function getEffectiveConfig(): EffectiveConfig | null {
  return getTenantConfigState().effectiveConfig;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the four domain services.
 *
 *   ReturnsService           (depends on prisma + auth + invoice + printRouter)
 *   InventoryAdjustmentsService (depends on prisma + auth)
 *   PrescriptionsService     (depends on prisma + auth)
 *   RecoveryLogService       (depends on prisma)
 */
export function createDomainServices(
  input: DomainServiceFactoryInput,
): DomainServices {
  const { prisma, auth, invoiceService, printRouter } = input;

  return {
    returnsService: createReturnsService(prisma, auth, invoiceService, printRouter),
    inventoryAdjustmentsService: createInventoryAdjustmentsService(prisma, auth),
    prescriptionsService: createPrescriptionsService(prisma, auth),
    recoveryLogService: createRecoveryLogService(prisma),
    productService: createProductService(prisma, auth),
  };
}
