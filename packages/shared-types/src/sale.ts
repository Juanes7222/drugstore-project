import { SaleOperationalState, SaleType } from "./enums";
import type { DeliveryState } from "./tenant-config";

export interface Sale {
  id: string;
  saleNumber: string;
  saleType: SaleType;
  operationalState: SaleOperationalState;
  clientId: string | null;
  cashierId: string;
  cashShiftId: string;
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  grandTotal: string;
  prescriptionNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Delivery (domicilio) data attached to a sale. Stored in the `Sale.delivery`
 * JSON column and carried inside the SALE_CONFIRMATION sync payload so the
 * server replay persists the same shape. Null column value = not a domicilio.
 */
export interface SaleDeliveryInfo {
  state: DeliveryState;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  /** ISO-8601 delivery date/time, when the tenant allows scheduling. */
  scheduledAt: string | null;
  /** Delivery fee in COP cents; 0 when the tenant charges no fee. */
  feeCents: number;
}
