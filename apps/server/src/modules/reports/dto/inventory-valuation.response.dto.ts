export class InventoryValuationResponseDto {
  valuationDate!: string;
  totalLotsActive!: number;
  totalLotsExpiring!: number;
  lotsWithUnknownCost!: number;
  totalInventoryValue!: string;
  breakdownByProduct!: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitCost: string;
    totalValue: string;
    expiringLotCount: number;
  }>;
}
