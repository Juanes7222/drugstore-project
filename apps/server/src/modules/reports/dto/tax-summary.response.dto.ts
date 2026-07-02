import { TaxSchemeType } from '@pharmacy/shared-types';

export class TaxSummaryResponseDto {
  reportPeriod!: {
    dateFrom: string;
    dateTo: string;
  };
  totalDocuments!: number;
  totalTaxableBase!: string;
  totalTaxAmount!: string;
  breakdownByTaxScheme!: Array<{
    taxSchemeType: TaxSchemeType;
    rate: string;
    taxableBase: string;
    taxAmount: string;
    documentCount: number;
  }>;
}
