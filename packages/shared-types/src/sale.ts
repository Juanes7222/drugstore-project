import { SaleOperationalState, SaleType } from "./enums";

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
