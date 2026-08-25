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

export type CustomersQueryDto = z.infer<typeof CustomersQuerySchema>;
export type CustomerIdParamDto = z.infer<typeof CustomerIdParamSchema>;
export type CustomerSalesQueryDto = z.infer<typeof CustomerSalesQuerySchema>;
