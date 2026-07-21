/**
 * Shared types for the Product Management feature's presentational components.
 *
 * @module products.types
 */

import type { SaleType } from '@pharmacy/database/local';

export type ProductFormMode = 'create' | 'edit';

export interface DisplayBarcode {
  id?: string;
  barcode: string;
  barcodeType: 'EAN13' | 'EAN14' | 'GTIN' | 'INTERNAL' | 'DATAMATRIX';
  isPrimary: boolean;
}

export interface DisplayPrice {
  price: string;
  effectiveFrom?: string;
  changeReason?: string;
}

export interface DisplayTax {
  taxSchemeId: string;
  effectiveFrom?: string;
  changeReason?: string;
}

export interface DisplayProduct {
  id: string;
  internalCode: string;
  commercialName: string;
  genericName: string;
  activePrinciple: string;
  concentration: string | null;
  concentrationUnit: string | null;
  laboratory: string;
  saleType: SaleType;
  minimumStock: number;
  isActive: boolean;
  invimaRegistry: string | null;
  atcCode: string | null;
  categoryId: string | null;
  pharmaceuticalFormId: string | null;
  therapeuticIndication: string | null;
  storageConditions: string | null;
  internalNotes: string | null;
  createdAt: string;
  updatedAt: string;
  barcodes: Array<{
    id: string;
    barcode: string;
    barcodeType: string;
    isPrimary: boolean;
  }>;
  currentPrice: string | null;
  currentTaxSchemeId: string | null;
}

export interface ProductFormData {
  commercialName: string;
  genericName: string;
  activePrinciple: string;
  concentration: string;
  concentrationUnit: string;
  laboratory: string;
  saleType: string;
  minimumStock: number;
  invimaRegistry: string;
  atcCode: string;
  therapeuticIndication: string;
  storageConditions: string;
  internalNotes: string;
  categoryId: string;
  pharmaceuticalFormId: string;
  barcodes: DisplayBarcode[];
  price: string;
  taxSchemeId: string;
}

export interface CategoryOption {
  id: string;
  name: string;
}

export interface PharmaceuticalFormOption {
  id: string;
  name: string;
}

export interface TaxSchemeOption {
  id: string;
  name: string;
  code: string;
  rate: number;
  taxType: string;
}

/** Visibility level for a product form field, driven by the tenant's StrictnessConfig. */
export type FieldVisibility = 'REQUIRED' | 'OPTIONAL' | 'HIDDEN';

/**
 * Per-field visibility requirements computed from the tenant's strictness
 * configuration.  Only fields that can be controlled by StrictnessConfig
 * are listed; always-visible fields are not included.
 */
export interface ProductFormFieldRequirements {
  minimumStock: FieldVisibility;
  atcCode: FieldVisibility;
  therapeuticIndication: FieldVisibility;
  invimaRegistry: FieldVisibility;
}
