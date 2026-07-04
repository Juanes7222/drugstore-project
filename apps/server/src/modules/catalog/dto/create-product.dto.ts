import { z } from 'zod';
import { SaleType } from '@pharmacy/shared-types';

export const CreateProductSchema = z.object({
  internalCode: z.string().min(1, 'Internal code is required'),
  commercialName: z.string().min(1, 'Commercial name is required'),
  genericName: z.string().min(1, 'Generic name is required'),
  activePrinciple: z.string().min(1, 'Active principle is required'),
  concentration: z.string().optional(),
  concentrationUnit: z.string().optional(),
  laboratory: z.string().min(1, 'Laboratory is required'),
  saleType: z.enum([SaleType.FREE_SALE, SaleType.PRESCRIPTION, SaleType.CONTROLLED_SUBSTANCE]),
  minimumStock: z.number().int().nonnegative().default(0),
  discontinuationReason: z.string().optional(),
  invimaRegistry: z.string().optional(),
  atcCode: z.string().optional(),
  therapeuticIndication: z.string().optional(),
  storageConditions: z.string().optional(),
  internalNotes: z.string().optional(),
  categoryId: z.uuid().optional(),
  pharmaceuticalFormId: z.uuid().optional(),
  initialPrice: z.string().min(1, 'Initial price is required'),
  initialTaxSchemeId: z.uuid('Initial tax scheme ID must be a valid UUID'),
});

export type CreateProductDto = z.infer<typeof CreateProductSchema>;
