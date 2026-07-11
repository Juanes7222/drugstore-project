/**
 * Shared types for the Returns feature's presentational components.
 *
 * @module returns.types
 */

export interface SaleSearchResult {
  id: string;
  sequentialNumber: number;
  createdAt: string;
  clientName: string;
  workstationName: string;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    quantity: number;
    unitPriceCents: number;
    taxPercentage: number;
    totalCents: number;
    lotCode: string;
  }>;
  totalCents: number;
}

export interface UnverifiedItemEntry {
  productId: string;
  productName: string;
  lotCode: string;
  quantity: number;
}

export type ReturnTab = "verified" | "unverified";

/** Format cents (COP) as a locale-aware currency string. */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(cents);
}
