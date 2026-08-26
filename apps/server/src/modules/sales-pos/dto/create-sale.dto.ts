import { CreateSaleSchema } from '@pharmacy/shared-validation';
import { z } from 'zod';
import type { SaleDeliveryInfo } from '@pharmacy/shared-types';

export class CreateSaleDto implements z.infer<typeof CreateSaleSchema> {
  saleType!: 'FREE_SALE' | 'PRESCRIPTION' | 'CONTROLLED_SUBSTANCE';
  /**
   * The shift the sale belongs to. Wire shape unchanged by the global shift
   * model; semantics widened — this now references THE tenant-wide shift
   * regardless of which workstation opened it, and on sync replay the
   * dispatcher may rewrite it to the current global OPEN shift's id when
   * the POS-recorded id has no server-side row yet.
   */
  cashShiftId!: string;
  clientId?: string | null;
  items!: Array<{
    productId: string;
    quantity: number;
    unitPrice: string;
    discount?: string;
    discountPercentage?: number;
    discountReason?: string;
    commissionType?: 'NONE' | 'PERCENTAGE' | 'FIXED' | null;
    commissionValue?: string | null;
    commissionAmount?: string;
  }>;
  prescriptionNumber?: string | null;
  /**
   * Pre-computed totals (subtotal, totalDiscount, totalTax, totalAmount)
   * snapshotted by the caller. When the offline-first POS replay path
   * provides these, the server stores them on the sale header instead of
   * recomputing from items, so payment-mismatch sync failures do not
   * appear when the server's catalog has drifted from the POS snapshot.
   * Optional: HTTP API callers may omit them and the server recomputes.
   */
  subtotal?: string;
  totalDiscount?: string;
  totalTax?: string;
  totalAmount?: string;
  /**
   * Domicilio (delivery) data attached to the sale. Null or absent when the
   * sale is not a domicilio. Persisted verbatim into the Sale.delivery JSON
   * column; the delivery fee is added on top of totalAmount by the
   * confirmation flow's amount-due validation.
   */
  delivery?: SaleDeliveryInfo | null;

  constructor(
    data?: (z.infer<typeof CreateSaleSchema> & { delivery?: SaleDeliveryInfo | null }) | null,
  ) {
    if (data) {
      this.saleType = data.saleType;
      this.cashShiftId = data.cashShiftId;
      this.clientId = data.clientId;
      this.items = data.items;
      this.prescriptionNumber = data.prescriptionNumber;
      this.subtotal = data.subtotal;
      this.totalDiscount = data.totalDiscount;
      this.totalTax = data.totalTax;
      this.totalAmount = data.totalAmount;
      this.delivery = data.delivery;
    }
  }
}

export type CreateSaleItemDto = {
  productId: string;
  quantity: number;
  unitPrice: string;
  discount?: string;
  discountPercentage?: number;
  discountReason?: string;
  /**
   * Commission evaluated by the offline POS at real sale time. When present
   * the server persists these verbatim on the SaleItem; when absent it
   * computes them from the product configuration (see
   * CommissionCalculatorService).
   */
  commissionType?: 'NONE' | 'PERCENTAGE' | 'FIXED' | null;
  commissionValue?: string | null;
  commissionAmount?: string;
};
