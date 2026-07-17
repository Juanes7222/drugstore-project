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
  unitPriceCents: number;
  taxPercentage: number;
  quantity: number;
}

export interface SelectedClient {
  id: string;
  name: string;
  identification: string;
}

export interface SalesState {
  items: CartItem[];
  selectedClient: SelectedClient | null;
}
