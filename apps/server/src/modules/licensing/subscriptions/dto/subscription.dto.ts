import { z } from 'zod';

export const CreateSubscriptionSchema = z.object({
  planId: z.string().uuid(),
  customerName: z.string().min(2).max(300),
  customerTaxId: z.string().min(3).max(50),
  customerEmail: z.string().email().optional().nullable(),
  customerPhone: z.string().max(30).optional().nullable(),
  customerAddress: z.string().max(500).optional().nullable(),
  status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED']).optional().default('TRIAL'),
  trialEndsAt: z.string().datetime().optional().nullable(),
  paymentMethod: z.string().max(100).optional().nullable(),
  gracePeriodDays: z.number().int().min(1).max(90).optional().default(7),
});

export const UpdateSubscriptionSchema = z.object({
  planId: z.string().uuid().optional(),
  customerName: z.string().min(2).max(300).optional(),
  customerTaxId: z.string().min(3).max(50).optional(),
  customerEmail: z.string().email().nullable().optional(),
  customerPhone: z.string().max(30).nullable().optional(),
  customerAddress: z.string().max(500).nullable().optional(),
  gracePeriodDays: z.number().int().min(1).max(90).optional(),
  paymentMethod: z.string().max(100).nullable().optional(),
  paymentReference: z.string().max(200).nullable().optional(),
});

export const RecordPaymentSchema = z.object({
  amountCents: z.number().int().positive(),
  currency: z.string().length(3).optional().default('COP'),
  paymentMethod: z.string().max(100).optional().nullable(),
  paymentReference: z.string().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  recordedById: z.string().uuid().optional().nullable(),
});

export type CreateSubscriptionDto = z.infer<typeof CreateSubscriptionSchema>;
export type UpdateSubscriptionDto = z.infer<typeof UpdateSubscriptionSchema>;
export type RecordPaymentDto = z.infer<typeof RecordPaymentSchema>;
