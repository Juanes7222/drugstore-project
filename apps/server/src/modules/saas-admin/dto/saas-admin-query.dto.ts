import { z } from 'zod';

/**
 * Query schemas for the saas-admin module. Local schemas (no shared
 * equivalent yet) — promotion candidates for @pharmacy/shared-validation.
 */

const pageSchema = z.coerce.number().int().min(1).max(1_000_000);
const pageSizeSchema = z.coerce.number().int().min(1).max(100);

export const PlatformOverviewQuerySchema = z.object({}).passthrough();

export const CustomersQuerySchema = z.object({
  page: pageSchema.optional(),
  pageSize: pageSizeSchema.optional(),
  query: z.string().min(1).max(200).optional(),
});

export const CustomerIdParamSchema = z.object({
  id: z.string().min(1).max(64),
});

export const CustomerSalesQuerySchema = z.object({
  page: pageSchema.optional(),
  pageSize: pageSizeSchema.optional(),
  from: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'from must be a parseable date',
    })
    .optional(),
  to: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'to must be a parseable date',
    })
    .optional(),
  state: z.string().min(1).max(30).optional(),
});

/** FraudAlertStatus values from the licensing schema, plus ALL. */
const fraudAlertStatusSchema = z.enum([
  'OPEN',
  'INVESTIGATING',
  'DISMISSED',
  'CONFIRMED_FRAUD',
]);

export const FraudAlertsQuerySchema = z.object({
  page: pageSchema.optional(),
  pageSize: pageSizeSchema.optional(),
  status: fraudAlertStatusSchema
    .or(z.literal('ALL'))
    .optional(),
});

export const FraudAlertIdParamSchema = z.object({
  id: z.string().min(1).max(64),
});

export const ResolveFraudAlertBodySchema = z.object({
  note: z.string().min(1).max(2000).optional(),
});

export const AccessAuditQuerySchema = z.object({
  page: pageSchema.optional(),
  pageSize: pageSizeSchema.optional(),
});

export const TrialsEndingQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
});

/** Lifecycle action bodies — platform operator, cross-tenant mutations. */
export const SuspendCustomerBodySchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

export const ChangePlanBodySchema = z.object({
  planCode: z.string().trim().min(1).max(50),
});

export const ExtendTrialBodySchema = z.object({
  days: z.coerce.number().int().min(1).max(90),
});

export const CustomerPaymentsQuerySchema = z.object({
  page: pageSchema.optional(),
  pageSize: pageSizeSchema.optional(),
});

export const AtRiskQuerySchema = z.object({
  inactiveDays: z.coerce.number().int().min(7).max(90).default(14),
});

export type CustomersQueryDto = z.infer<typeof CustomersQuerySchema>;
export type CustomerIdParamDto = z.infer<typeof CustomerIdParamSchema>;
export type CustomerSalesQueryDto = z.infer<typeof CustomerSalesQuerySchema>;
export type FraudAlertsQueryDto = z.infer<typeof FraudAlertsQuerySchema>;
export type FraudAlertIdParamDto = z.infer<typeof FraudAlertIdParamSchema>;
export type ResolveFraudAlertBodyDto = z.infer<
  typeof ResolveFraudAlertBodySchema
>;
export type AccessAuditQueryDto = z.infer<typeof AccessAuditQuerySchema>;
export type TrialsEndingQueryDto = z.infer<typeof TrialsEndingQuerySchema>;
export type SuspendCustomerBodyDto = z.infer<typeof SuspendCustomerBodySchema>;
export type ChangePlanBodyDto = z.infer<typeof ChangePlanBodySchema>;
export type ExtendTrialBodyDto = z.infer<typeof ExtendTrialBodySchema>;
export type CustomerPaymentsQueryDto = z.infer<
  typeof CustomerPaymentsQuerySchema
>;
export type AtRiskQueryDto = z.infer<typeof AtRiskQuerySchema>;
