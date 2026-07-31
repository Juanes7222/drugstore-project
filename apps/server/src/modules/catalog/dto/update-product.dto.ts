import { z } from 'zod';
import { SaleType, CommissionType } from '@pharmacy/shared-types';

export const UpdateProductSchema = z.object({
  commercialName: z.string().min(1).optional(),
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
  categoryId: z.string().min(1).optional().nullable(),
  pharmaceuticalFormId: z.string().min(1).optional().nullable(),
  isActive: z.boolean().optional(),
  unitPrice: z.string().optional(),
  initialPrice: z.string().optional(),
  initialCost: z.string().optional(),
  cost: z.string().optional(),
  initialTaxSchemeId: z.string().min(1).optional(),
  // Sales-commission fields. Optional so legacy POS builds that do not
  // send them leave the current configuration untouched. Dates accept
  // null to clear the window bounds.
  commissionType: z
    .enum([CommissionType.NONE, CommissionType.PERCENTAGE, CommissionType.FIXED])
    .optional(),
  commissionValue: z.coerce.number().min(0, 'Commission value cannot be negative').optional(),
  commissionStartsAt: z.iso.datetime().nullable().optional(),
  commissionEndsAt: z.iso.datetime().nullable().optional(),
}).refine(
  (data) =>
    !data.commissionStartsAt ||
    !data.commissionEndsAt ||
    data.commissionStartsAt <= data.commissionEndsAt,
  {
    message: 'INVALID_COMMISSION: commission start date must not be after the end date',
    path: ['commissionStartsAt'],
  },
);

export type UpdateProductDto = z.infer<typeof UpdateProductSchema>;
