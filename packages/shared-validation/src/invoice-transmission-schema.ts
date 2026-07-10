import { z } from 'zod';

/**
 * DIAN invoice types relevant to offline contingency invoicing.
 * ELECTRONIC_INVOICE: standard invoice (factura electrónica)
 * CREDIT_NOTE: nota crédito
 * DEBIT_NOTE: nota débito
 * SUPPORT_DOCUMENT: documento soporte
 * CONTINGENCY_CANCELLATION: cancelación de factura en contingencia
 */
export const DianInvoiceType = z.enum([
  'ELECTRONIC_INVOICE',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'SUPPORT_DOCUMENT',
  'CONTINGENCY_CANCELLATION',
]);

export const InvoiceSellerSchema = z.object({
  nit: z.string().min(1, 'Seller NIT is required'),
  name: z.string().min(1, 'Seller name is required'),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  resolutionNumber: z.string().nullable().optional(),
  resolutionDate: z.string().nullable().optional(),
});

export type InvoiceSellerInput = z.infer<typeof InvoiceSellerSchema>;

export const InvoiceBuyerSchema = z.object({
  identificationType: z.string().nullable().optional(),
  identificationNumber: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
});

export type InvoiceBuyerInput = z.infer<typeof InvoiceBuyerSchema>;

export const InvoiceLineItemSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  internalCode: z.string().min(1, 'Internal code is required'),
  commercialName: z.string().min(1, 'Commercial name is required'),
  quantity: z.number().positive('Quantity must be positive'),
  unitPrice: z.string().min(1, 'Unit price is required'),
  taxRate: z.string().min(1, 'Tax rate is required'),
  taxAmount: z.string().min(1, 'Tax amount is required'),
  subtotal: z.string().min(1, 'Subtotal is required'),
  total: z.string().min(1, 'Total is required'),
});

export type InvoiceLineItemInput = z.infer<typeof InvoiceLineItemSchema>;

export const InvoiceTaxSummarySchema = z.object({
  scheme: z.string().min(1, 'Tax scheme is required'),
  rate: z.string().min(1, 'Tax rate is required'),
  taxableAmount: z.string().min(1, 'Taxable amount is required'),
  taxAmount: z.string().min(1, 'Tax amount is required'),
});

export type InvoiceTaxSummaryInput = z.infer<typeof InvoiceTaxSummarySchema>;

export const InvoicePaymentSchema = z.object({
  paymentMethodName: z.string().min(1, 'Payment method name is required'),
  amount: z.string().min(1, 'Amount is required'),
});

export type InvoicePaymentInput = z.infer<typeof InvoicePaymentSchema>;

export const FullInvoiceDataSchema = z.object({
  invoiceType: DianInvoiceType,
  invoiceNumber: z.string().min(1, 'Invoice number is required'),
  contingencyNumber: z.string().nullable().optional(),
  seller: InvoiceSellerSchema,
  buyer: InvoiceBuyerSchema.optional().default({}),
  lineItems: z.array(InvoiceLineItemSchema).min(1, 'At least one line item is required'),
  taxSummaries: z.array(InvoiceTaxSummarySchema).min(1, 'At least one tax summary is required'),
  payments: z.array(InvoicePaymentSchema).min(1, 'At least one payment is required'),
  subtotal: z.string().min(1, 'Subtotal is required'),
  totalDiscount: z.string().min(1, 'Total discount is required'),
  totalTax: z.string().min(1, 'Total tax is required'),
  totalAmount: z.string().min(1, 'Total amount is required'),
  changeAmount: z.string().min(1, 'Change amount is required'),
  issuedAt: z.string().datetime('Invalid ISO-8601 datetime'),
  currency: z.string().default('COP'),
});

export type FullInvoiceDataInput = z.infer<typeof FullInvoiceDataSchema>;

/**
 * Zod schema for the INVOICE_TRANSMISSION sync operation payload.
 * Validates that all required DIAN fields are present before
 * forwarding the document to the fiscal engine.
 */
export const InvoiceTransmissionPayloadSchema = z.object({
  invoiceId: z.string().uuid('invoiceId must be a valid UUID'),
  invoiceNumber: z.string().min(1, 'invoiceNumber is required'),
  contingencyNumber: z.string().nullable().optional(),
  saleId: z.string().uuid('saleId must be a valid UUID'),
  provisionalCufe: z
    .string()
    .length(64, 'provisionalCufe must be a 64-character hex SHA-384 hash')
    .regex(/^[0-9a-f]{64}$/i, 'provisionalCufe must be a valid hex string'),
  workstationId: z.string().min(1, 'workstationId is required'),
  fullInvoiceData: FullInvoiceDataSchema,
});

export type InvoiceTransmissionPayloadInput = z.infer<typeof InvoiceTransmissionPayloadSchema>;
