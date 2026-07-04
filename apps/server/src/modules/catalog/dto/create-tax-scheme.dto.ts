import { z } from 'zod';
import { TaxSchemeType } from '@pharmacy/shared-types';

export const CreateTaxSchemeSchema = z.object({
  code: z.string().min(1, 'Tax code is required'),
  name: z.string().min(1, 'Tax name is required'),
  taxType: z.enum([
    TaxSchemeType.IVA,
    TaxSchemeType.INC,
    TaxSchemeType.RETEFUENTE,
    TaxSchemeType.RETEICA,
    TaxSchemeType.IMPOCONSUMO,
    TaxSchemeType.EXENTO,
  ]),
  rate: z.string().min(1, 'Tax rate is required'),
  effectiveFrom: z.string().datetime(),
});

export type CreateTaxSchemeDto = z.infer<typeof CreateTaxSchemeSchema>;
