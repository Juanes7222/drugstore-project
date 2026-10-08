import { z } from "zod";

export const PaymentInputSchema = z.object({
  paymentMethodId: z.uuid("ID de método de pago inválido"),
  amount: z.number().positive("El monto del pago debe ser mayor a cero"),
  transactionReference: z.string().max(100).optional(),
  authorizationCode: z.string().max(100).optional(),
  cardBrand: z.string().max(50).optional(),
  cardLastFour: z.string().length(4).optional(),
  batchNumber: z.string().max(100).optional(),
  processorResponseCode: z.string().max(100).optional(),
});

/**
 * @deprecated The `.min(1)` constraint has been removed from the HTTP-level
 * DTO because the POS now validates payments locally and submits sales via
 * `POST /sync/batch`. The authoritative "at least one payment" validation
 * has been relocated to `SalesService.confirm()` so that sync dispatcher
 * replays are also protected.
 */
export const ConfirmSaleSchema = z.object({
  payments: z.array(PaymentInputSchema),
  /**
   * Cash the customer actually handed over, when it exceeds the amount due.
   *
   * The POS keeps the tendered figure separate from the payment rows (the cash
   * row carries the amount applied to the sale, the "received" field carries
   * what the customer gave). Without this the change only exists in the
   * renderer, so `Sale.changeAmount` persisted 0 both locally and here even
   * though cash left the drawer as change.
   */
  cashReceived: z.number().nonnegative("El efectivo recibido no puede ser negativo").optional(),
});

export type ConfirmSaleDto = z.infer<typeof ConfirmSaleSchema>;
