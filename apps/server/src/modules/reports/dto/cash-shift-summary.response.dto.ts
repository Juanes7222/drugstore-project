import { PaymentMethodCategory } from '@pharmacy/shared-types';

export class CashShiftSummaryResponseDto {
  totalShifts!: number;
  totalCashMovement!: string;
  breakdownByPaymentMethod!: Array<{
    paymentMethodCategory: PaymentMethodCategory;
    count: number;
    totalAmount: string;
    averageAmount: string;
  }>;
}
