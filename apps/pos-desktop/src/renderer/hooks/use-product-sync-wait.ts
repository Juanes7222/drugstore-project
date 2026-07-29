/**
 * Hook to wait for a product to be synced to the server.
 *
 * Used when a sale is blocked because a product the cashier is trying to
 * sell has not yet been pushed to the server (PRODUCT_NOT_SYNCED_YET).
 * The hook returns a function that:
 *   1. Triggers an immediate sync push via the SyncScheduler
 *   2. Polls the local product row for a non-null `serverId`
 *   3. Resolves with `true` once the product is synced, or `false` on timeout
 *
 * The polling window is short (default 15s) — long enough to ride out
 * one or two failed network attempts, short enough to surface a real
 * connectivity problem without freezing the cashier.
 *
 * Safe to use outside a <ServiceProvider> — when the scheduler is not
 * available, the trigger step is silently skipped and the hook still
 * polls the local DB for the sync state. This keeps test setups simple.
 */

import { useCallback, useContext } from "react";
import { ServiceContext } from "../components/common/service-context";
import { getLocalDatabase } from "../../infrastructure/local-database";
import type { PrismaClient } from "@pharmacy/database/local";

const DEFAULT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 500;

export function useProductSyncWait() {
  // Read the context directly. Returns null when no provider is present,
  // which is fine for unit tests that don't wrap in <ServiceProvider>.
  const ctx = useContext(ServiceContext);

  return useCallback(
    async (
      productId: string,
      timeoutMs: number = DEFAULT_TIMEOUT_MS,
    ): Promise<boolean> => {
      // Trigger an immediate push of any pending product-creation
      // operations. The scheduler's auto-push path picks up PENDING rows
      // in clientSequence order, so a PRODUCT_CREATION that's ahead of
      // a SALE_CONFIRMATION in the queue will be sent first.
      try {
        ctx?.syncScheduler.triggerPush();
      } catch {
        // Swallow — the polling loop below is the source of truth.
      }

      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        try {
          const { prisma: rawPrisma } = await getLocalDatabase();
          const prisma = rawPrisma as PrismaClient;
          const row = await prisma.product.findUnique({
            where: { id: productId },
            select: { serverId: true },
          });
          if (row?.serverId) {
            return true;
          }
        } catch {
          // Local DB unavailable — keep polling until deadline.
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      return false;
    },
    [ctx],
  );
}
