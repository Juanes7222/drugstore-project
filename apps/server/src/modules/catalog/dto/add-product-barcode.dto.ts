import { z } from 'zod';

export const AddProductBarcodeSchema = z.object({
  barcode: z.string().min(1, 'Barcode is required'),
  barcodeType: z.enum(['EAN13', 'EAN14', 'GTIN', 'INTERNAL', 'DATAMATRIX']),
  isPrimary: z.boolean().default(false),
});

export type AddProductBarcodeDto = z.infer<typeof AddProductBarcodeSchema>;
