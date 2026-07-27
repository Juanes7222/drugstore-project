/**
 * Cart line item type used by the sales slice.
 *
 * Extends the shared Product type with the lot selected for this line and
 * derived numeric values needed for fast totals calculation.
 */
import { SaleType } from "@pharmacy/shared-types";

export interface CartItem {
  id: string;
  productId: string;
  name: string;
  genericName: string;
  invimaCertificate: string;
  saleType: SaleType;
  requiresPrescription: boolean;
  isRestricted: boolean;
  lotCode: string;
  lotExpirationDate: string;
  /** The active unit price in cents — catalog price, or overridden. */
  unitPriceCents: number;
  /** When non-null, the price was manually overridden at sale time. */
  overrideUnitPriceCents: number | null;
  /** Percentage discount applied to this line (0–100). Null = no explicit discount. */
  discountPercentage: number | null;
  /** Cost per unit in cents. Used for inline price-below-cost validation. */
  costCents: number | null;
  taxPercentage: number;
  quantity: number;
}

export interface SelectedClient {
  id: string;
  name: string;
  identification: string;
}

export const GENERIC_CLIENT: SelectedClient = {
  id: "generic-consumidor-final",
  name: "CONSUMIDOR FINAL",
  identification: "0000000000-0",
};

export interface SalesState {
  items: CartItem[];
  selectedClient: SelectedClient | null;
}
