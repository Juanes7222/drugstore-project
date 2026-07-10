import { z } from 'zod';

export const CreatePlanSchema = z.object({
  code: z.string().min(2).max(50),
  name: z.string().min(2).max(200),
  description: z.string().max(1000).optional(),
  pricingModel: z.enum(['FLAT', 'PER_LOCATION', 'PER_WORKSTATION', 'TIERED']),
  basePriceCents: z.number().int().min(0),
  currency: z.string().length(3).optional().default('COP'),
  billingPeriod: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL']).optional().default('MONTHLY'),
  maxLocations: z.number().int().min(1).optional().default(1),
  maxWorkstationsPerLocation: z.number().int().min(1).optional().default(1),
  includedWorkstations: z.number().int().min(0).optional().default(1),
  extraWorkstationPriceCents: z.number().int().min(0).nullable().optional(),
  features: z.array(z.string()).optional().default([]),
  displayOrder: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
  isPublic: z.boolean().optional().default(false),
});

export const UpdatePlanSchema = z.object({
  code: z.string().min(2).max(50).optional(),
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  pricingModel: z.enum(['FLAT', 'PER_LOCATION', 'PER_WORKSTATION', 'TIERED']).optional(),
  basePriceCents: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  billingPeriod: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL']).optional(),
  maxLocations: z.number().int().min(1).optional(),
  maxWorkstationsPerLocation: z.number().int().min(1).optional(),
  includedWorkstations: z.number().int().min(0).optional(),
  extraWorkstationPriceCents: z.number().int().min(0).nullable().optional(),
  features: z.array(z.string()).optional(),
  displayOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

export type CreatePlanDto = z.infer<typeof CreatePlanSchema>;
export type UpdatePlanDto = z.infer<typeof UpdatePlanSchema>;

export interface PlanFilterDto {
  isActive?: boolean;
  isPublic?: boolean;
}
