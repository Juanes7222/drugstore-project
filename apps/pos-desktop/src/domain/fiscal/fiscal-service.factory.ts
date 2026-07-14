/**
 * Fiscal service factory — creates the full set of interconnected fiscal
 * domain services from a PrismaClient and workstation ID.
 *
 * Extracted from the monolithic service-context.tsx initialisation block so
 * that the creation logic can be unit-tested without mounting a React tree.
 */

import type { PrismaClient } from '@pharmacy/database/local';
import { createFiscalNumberingService } from './numbering.service';
import type { FiscalNumberingService } from './numbering.service';
import { createContingencyService } from './contingency.service';
import type { ContingencyService } from './contingency.service';
import { createInvoiceService } from './invoice.service';
import type { InvoiceService } from './invoice.service';
import { createFiscalScheduler } from './fiscal-scheduler.service';
import type { FiscalScheduler } from './fiscal-scheduler.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FiscalServices {
  fiscalNumberingService: FiscalNumberingService;
  contingencyService: ContingencyService;
  invoiceService: InvoiceService;
  fiscalScheduler: FiscalScheduler;
}

export interface FiscalServiceFactoryInput {
  prisma: PrismaClient;
  workstationId: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the four fiscal services, wiring their interdependencies:
 *
 *   FiscalNumberingService  (standalone)
 *   ContingencyService      (standalone)
 *   InvoiceService          (depends on numbering + contingency)
 *   FiscalScheduler         (depends on invoice + contingency)
 */
export function createFiscalServices(
  input: FiscalServiceFactoryInput,
): FiscalServices {
  const { prisma, workstationId } = input;

  const fiscalNumberingService = createFiscalNumberingService({
    prisma,
    workstationId,
  });

  const contingencyService = createContingencyService({
    prisma,
    workstationId,
  });

  const invoiceService = createInvoiceService({
    prisma,
    workstationId,
    numberingService: fiscalNumberingService,
    contingencyService,
  });

  const fiscalScheduler = createFiscalScheduler({
    invoiceService,
    contingencyService,
  });

  return {
    fiscalNumberingService,
    contingencyService,
    invoiceService,
    fiscalScheduler,
  };
}
