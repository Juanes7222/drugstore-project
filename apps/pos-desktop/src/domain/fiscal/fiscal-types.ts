/**
 * Domain types for the fiscal / DIAN contingency module.
 *
 * These types are intentionally plain objects so they can be serialized into
 * the Invoice.fullData JSON column and into SyncQueue payloads without losing
 * information needed for CUFE re-calculation and PDF re-generation.
 */

import type { Prisma } from '@pharmacy/database/local';

export type InvoiceType =
  | 'ELECTRONIC_INVOICE'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'SUPPORT_DOCUMENT'
  | 'CONTINGENCY_CANCELLATION';

export type InvoiceStatus =
  | 'CONTINGENCY_PENDING_TRANSMISSION'
  | 'TRANSMITTED_AUTHORIZED'
  | 'TRANSMITTED_REJECTED'
  | 'EXPIRED_CONTINGENCY'
  | 'CANCELLED';

export type ContingencyTrigger =
  | 'NETWORK_LOST'
  | 'MANUAL_OVERRIDE'
  | 'SERVER_UNREACHABLE';

export interface InvoiceLineItem {
  productId: string;
  internalCode: string;
  commercialName: string;
  genericName: string | null;
  concentration: string | null;
  quantity: number;
  unitPrice: string; // Decimal as string for JSON safety
  discountPercentage: string;
  discountAmount: string;
  discountReason: string | null;
  taxRate: string;
  taxAmount: string;
  subtotal: string;
  total: string;
}

export interface InvoicePayment {
  paymentMethodId: string;
  paymentMethodName: string;
  amount: string;
  category: string;
  transactionReference: string | null;
  authorizationCode: string | null;
  cardBrand: string | null;
  cardLastFour: string | null;
}

export interface InvoiceTaxSummary {
  scheme: string;
  rate: string;
  taxableAmount: string;
  taxAmount: string;
}

export interface InvoiceBuyer {
  identificationType: string | null;
  identificationNumber: string | null;
  name: string; // "consumidor final" when anonymous
  email: string | null;
  phone: string | null;
  address: string | null;
}

export interface InvoiceSeller {
  nit: string;
  name: string;
  address: string | null;
  phone: string | null;
  resolutionNumber: string | null;
  resolutionDate: string | null;
  resolutionPrefix: string;
}

export interface InvoiceFullData {
  invoiceType: InvoiceType;
  invoiceNumber: string;
  contingencyNumber: string | null;
  relatedInvoiceNumber: string | null;
  seller: InvoiceSeller;
  buyer: InvoiceBuyer;
  lineItems: InvoiceLineItem[];
  taxSummaries: InvoiceTaxSummary[];
  payments: InvoicePayment[];
  subtotal: string;
  totalDiscount: string;
  totalTax: string;
  totalAmount: string;
  changeAmount: string;
  issuedAt: string;
  currency: string;
  prescriptionNumber: string | null;
  workstationCode: string;
}

/**
 * Narrow Invoice shape used by the CUFE calculator. Built from the full data
 * payload so the same calculation can be reproduced from a stored invoice.
 */
export interface CufeInvoiceData {
  sellerNit: string;
  invoiceType: InvoiceType;
  invoiceNumber: string;
  issuedAt: string;
  subtotal: string;
  totalTax: string;
  totalAmount: string;
  buyerIdentification: string;
  buyerName: string;
  taxSummaries: Array<{ scheme: string; rate: string; taxAmount: string }>;
}

export interface ContingencyEventSummary {
  id: string;
  startedAt: string;
  endedAt: string | null;
  workstationId: string;
  trigger: ContingencyTrigger;
  triggerReason: string;
  invoicesGenerated: number;
  invoicesTransmitted: number;
  invoicesExpired: number;
  notifiedDian: boolean;
}

export interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  contingencyNumber: string | null;
  invoiceType: InvoiceType;
  status: InvoiceStatus;
  issuedAt: string;
  expiresAt: string | null;
  cufeProvisional: string;
  cufeOfficial: string | null;
  totalAmount: string;
  clientName: string;
}

export interface FiscalSummary {
  contingencyActive: boolean;
  pendingContingencyInvoices: number;
  expiringWithin24h: number;
  expiredContingencyInvoices: number;
  transmittedLast24h: number;
  rejectedLast24h: number;
}

/**
 * Data needed to generate a credit note from a client return.
 *
 * Passed by the caller (ReturnsService) which already has this data,
 * avoiding the need for the invoice service to query the return table.
 */
export interface CreditNoteInput {
  saleId: string;
  refundAmount: string;
  subtotalReturned: string;
  taxReturned: string;
  reason: string | null;
  items: Array<{
    saleItemId: string;
    quantity: number;
    unitPriceAtReturn: string;
    taxAmount: string;
    totalAmount: string;
    unitPriceAtSale: string;
  }>;
}

export type InvoiceModel = {
  id: string;
  saleId: string;
  workstationId: string;
  invoiceType: InvoiceType;
  invoiceNumber: string;
  contingencyNumber: string | null;
  status: InvoiceStatus;
  cufeProvisional: string;
  cufeOfficial: string | null;
  issuedAt: Date;
  transmittedAt: Date | null;
  expiresAt: Date;
  fiscalXml: string | null;
  fiscalPdfPath: string | null;
  relatedInvoiceId: string | null;
  contingencyEventId: string | null;
  techKeySnapshot: string;
  fullData: Prisma.JsonValue;
};
