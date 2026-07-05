import { CreateFiscalResolutionSchema } from './create-fiscal-resolution.schema';
import { z } from 'zod';

export class CreateFiscalResolutionDto
  implements z.infer<typeof CreateFiscalResolutionSchema>
{
  resolutionNumber!: string;
  documentType!: 'INVOICE' | 'POS_TICKET' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'SUPPORT_DOCUMENT';
  prefix!: string;
  rangeFrom!: number;
  rangeTo!: number;
  validFrom!: string;
  validTo!: string;
  workstationId!: string | null;

  constructor(data?: z.infer<typeof CreateFiscalResolutionSchema>) {
    if (data) {
      this.resolutionNumber = data.resolutionNumber;
      this.documentType = data.documentType as any;
      this.prefix = data.prefix;
      this.rangeFrom = data.rangeFrom;
      this.rangeTo = data.rangeTo;
      this.validFrom = data.validFrom;
      this.validTo = data.validTo;
      this.workstationId = data.workstationId ?? null;
    }
  }
}
