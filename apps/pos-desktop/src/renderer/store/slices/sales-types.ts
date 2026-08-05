/**
 * Cart line item type used by the sales slice.
 *
 * Extends the shared Product type with the lot selected for this line and
 * derived numeric values needed for fast totals calculation.
 */
import { CommissionType, DeliveryState, SaleType } from "@pharmacy/shared-types";

export interface CartItem {
  id: string;
  productId: string;
  name: string;
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
  /** Commission configuration snapshot from the catalog item; null when none. */
  commissionType: CommissionType | null;
  /** Percentage points (PERCENTAGE) or COP per unit (FIXED) as decimal string. */
  commissionValue: string | null;
  /** Optional validity window start (inclusive), ISO, or null. */
  commissionStartsAt: string | null;
  /** Optional validity window end (inclusive), ISO, or null. */
  commissionEndsAt: string | null;
}

export interface SelectedClient {
  id: string;
  name: string;
  identification: string;
  /** Contact data used to prefill the delivery form; null when unknown. */
  address?: string | null;
  phone?: string | null;
}

export const GENERIC_CLIENT: SelectedClient = {
  id: "generic-consumidor-final",
  name: "CONSUMIDOR FINAL",
  identification: "0000000000-0",
  address: null,
  phone: null,
};

/**
 * In-progress domicilio capture for the active sale, mirroring the
 * persisted `SaleDeliveryInfo` shape (minus the client, which lives on the
 * sale itself via `selectedClient`). Null = the sale is not a domicilio.
 */
export interface SaleDeliveryDraft {
  state: DeliveryState;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  /** ISO-8601 delivery date/time, only when the tenant allows scheduling. */
  scheduledAt: string | null;
  /** Delivery fee in COP cents; 0 when the tenant charges no fee. */
  feeCents: number;
}

export interface SalesState {
  items: CartItem[];
  selectedClient: SelectedClient | null;
  delivery: SaleDeliveryDraft | null;
}
