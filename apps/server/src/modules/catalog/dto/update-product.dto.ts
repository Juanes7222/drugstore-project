import { z } from 'zod';
import { SaleType } from '@pharmacy/shared-types';

export const UpdateProductSchema = z.object({
  commercialName: z.string().min(1).optional(),
  genericName: z.string().min(1).optional(),
  activePrinciple: z.string().min(1).optional(),
  concentration: z.string().optional(),
  concentrationUnit: z.string().optional(),
  laboratory: z.string().min(1).optional(),
  saleType: z.enum([SaleType.FREE_SALE, SaleType.PRESCRIPTION, SaleType.CONTROLLED_SUBSTANCE]).optional(),
  minimumStock: z.number().int().nonnegative().optional(),
  discontinuationReason: z.string().optional(),
  invimaRegistry: z.string().optional(),
  atcCode: z.string().optional(),
  therapeuticIndication: z.string().optional(),
  storageConditions: z.string().optional(),
  internalNotes: z.string().optional(),
  categoryId: z.string().uuid().optional().nullable(),
  pharmaceuticalFormId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
});

export type UpdateProductDto = z.infer<typeof UpdateProductSchema>;
