/**
 * Unit tests for PaymentMethodSyncService — upserting payment methods.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PaymentMethodSyncService } from "./payment-method-sync.service";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PaymentMethodSyncService", () => {
  let tx: any;
  let prisma: any;
  let service: PaymentMethodSyncService;

  beforeEach(() => {
    tx = {
      paymentMethod: { upsert: vi.fn() },
    };
    prisma = {
      $transaction: vi.fn(async (cb: (t: any) => unknown) => cb(tx)),
    };
    service = new PaymentMethodSyncService(prisma);
  });

  describe("syncPaymentMethods", () => {
    it("upserts each payment method inside a transaction", async () => {
      const methods = [
        { id: "pm-1", internalCode: "CASH", name: "Efectivo", category: "CASH", isCash: true, sortOrder: 1, isActive: true },
        { id: "pm-2", internalCode: "CARD", name: "Tarjeta Débito", category: "ELECTRONIC", isCash: false, sortOrder: 2, isActive: true },
      ];

      await service.syncPaymentMethods(methods);

      expect(tx.paymentMethod.upsert).toHaveBeenCalledTimes(2);
      expect(tx.paymentMethod.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "pm-1" },
          create: expect.objectContaining({ internalCode: "CASH", name: "Efectivo" }),
        }),
      );
    });

    it("handles empty array without error", async () => {
      await service.syncPaymentMethods([]);

      expect(tx.paymentMethod.upsert).not.toHaveBeenCalled();
    });
  });
});
