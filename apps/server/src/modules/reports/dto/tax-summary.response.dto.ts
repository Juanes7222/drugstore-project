export class TaxSummaryResponseDto {
  reportPeriod!: {
    dateFrom: string;
    dateTo: string;
  };
  totalDocuments!: number;
  totalTaxableBase!: string;
  totalTaxAmount!: string;
  breakdownByTaxRate!: Array<{
    taxRate: string;
    taxableBase: string;
    taxAmount: string;
    documentCount: number;
  }>;
}
