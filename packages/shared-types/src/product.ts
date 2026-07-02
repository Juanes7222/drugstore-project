import { SaleType } from "./enums";

export interface Product {
  id: string;
  name: string;
  genericName: string;
  barcode: string;
  invimaCertificate: string;
  saleType: SaleType;
  requiresPrescription: boolean;
  currentStock: number;
  minimumStock: number;
  purchasePrice: string;
  sellingPrice: string;
  taxPercentage: string;
  isActive: boolean;
  expirationDate: string;
  createdAt: string;
  updatedAt: string;
}
