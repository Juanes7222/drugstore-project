export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  taxPercentage: string;
  taxAmount: string;
  discount: string;
  lineTotal: string;
}
