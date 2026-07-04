import { z } from "zod";

export const PaymentInputSchema = z.object({
  paymentMethodId: z.string().uuid("ID de método de pago inválido"),
  amount: z.number().positive("El monto del pago debe ser mayor a cero"),
  transactionReference: z.string().max(100).optional(),
  authorizationCode: z.string().max(100).optional(),
  cardBrand: z.string().max(50).optional(),
  cardLastFour: z.string().length(4).optional(),
  batchNumber: z.string().max(100).optional(),
  processorResponseCode: z.string().max(100).optional(),
});

export const ConfirmSaleSchema = z.object({
  payments: z.array(PaymentInputSchema).min(1, "Debe haber al menos un pago"),
});

export type ConfirmSaleDto = z.infer<typeof ConfirmSaleSchema>;
