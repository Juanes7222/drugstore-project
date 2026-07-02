import { SaleType } from '@pharmacy/shared-types';

export class SalesSummaryResponseDto {
  totalSales!: string;
  totalQuantity!: number;
  breakdownBySaleType!: Array<{
    saleType: SaleType;
    count: number;
    totalAmount: string;
    averageAmount: string;
  }>;
}
