/**
 * Payment-method synchronizer for the POS desktop.
 *
 * Receives a list of payment methods from the server's `pos-settings`
 * payload and upserts them into the local PGlite table inside a single
 * transaction.  Payment methods that are present locally but absent
 * from the payload are *not* deleted — they are instead marked as
 * inactive via the server-provided `isActive` flag.
 *
 * The POS billing interface MUST filter by `isActive = true` when
 * presenting payment options to the user.
 */

import { PrismaClient } from '@pharmacy/database/local';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PosPaymentMethodRow {
  id: string;
  internalCode: string;
  name: string;
  dianCode?: string;
  category: string;
  isCash: boolean;
  sortOrder: number;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PaymentMethodSyncService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Upsert the full set of payment methods from the server.
   *
   * Runs inside a single local transaction.  Any row-level conflict
   * (e.g. duplicate `internalCode`) causes a full rollback, preserving
   * the last known good configuration.
   */
  async syncPaymentMethods(methods: PosPaymentMethodRow[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const method of methods) {
        await tx.paymentMethod.upsert({
          where: { id: method.id },
          create: {
            id: method.id,
            internalCode: method.internalCode,
            name: method.name,
            dianCode: method.dianCode ?? null,
            category: method.category as any,
            isCash: method.isCash,
            sortOrder: method.sortOrder,
            isActive: method.isActive,
          },
          update: {
            internalCode: method.internalCode,
            name: method.name,
            dianCode: method.dianCode ?? null,
            category: method.category as any,
            isCash: method.isCash,
            sortOrder: method.sortOrder,
            isActive: method.isActive,
          },
        });
      }
    });
  }
}