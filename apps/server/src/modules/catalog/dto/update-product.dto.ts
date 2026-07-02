import { ProductSchema } from '@pharmacy/shared-validation';
import { z } from 'zod';

export class UpdateProductDto {
  genericName?: string;
  commercialName?: string;
  laboratoryName?: string;
  pharmaceuticalFormId?: string;
  concentration?: string;
  categoryId?: string;
  isFreeToSale?: boolean;
  requiresPrescription?: boolean;
  sku?: string;
  currentPrice?: string;
  currentTaxSchemeId?: string;

  constructor(data?: any) {
    if (data) {
      this.genericName = data.genericName;
      this.commercialName = data.commercialName;
      this.laboratoryName = data.laboratoryName;
      this.pharmaceuticalFormId = data.pharmaceuticalFormId;
      this.concentration = data.concentration;
      this.categoryId = data.categoryId;
      this.isFreeToSale = data.isFreeToSale;
      this.requiresPrescription = data.requiresPrescription;
      this.sku = data.sku;
      this.currentPrice = data.currentPrice;
      this.currentTaxSchemeId = data.currentTaxSchemeId;
    }
  }
}
