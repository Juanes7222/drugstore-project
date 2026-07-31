import { z } from 'zod';
import { SaleType, CommissionType } from '@pharmacy/shared-types';

export const CreateProductSchema = z.object({
  internalCode: z.string().min(1, 'Internal code is required'),
  commercialName: z.string().min(1, 'Commercial name is required'),
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
  categoryId: z.string().min(1).optional(),
  pharmaceuticalFormId: z.string().min(1).optional(),
  initialPrice: z.string().min(1, 'Initial price is required'),
  initialTaxSchemeId: z.string().min(1, 'Initial tax scheme ID is required'),
  initialCost: z.string().optional(),
  // Sales-commission configuration. Optional so legacy POS builds and
  // direct API callers that do not send it keep the NONE default.
  commissionType: z
    .enum([CommissionType.NONE, CommissionType.PERCENTAGE, CommissionType.FIXED])
    .default(CommissionType.NONE),
  commissionValue: z.coerce.number().min(0, 'Commission value cannot be negative').default(0),
  commissionStartsAt: z.iso.datetime().optional(),
  commissionEndsAt: z.iso.datetime().optional(),
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

export type CreateProductDto = z.infer<typeof CreateProductSchema>;
