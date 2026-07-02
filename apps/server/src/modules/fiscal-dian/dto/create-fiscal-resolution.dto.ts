import { CreateFiscalResolutionSchema } from './create-fiscal-resolution.schema';
import { z } from 'zod';

export class CreateFiscalResolutionDto
  implements z.infer<typeof CreateFiscalResolutionSchema>
{
  workstationId!: string;
  documentType!: 'INVOICE' | 'POS_TICKET' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  prefix!: string;
  rangeStart!: string;
  rangeEnd!: string;
  validFrom!: string;
  validUntil!: string;

  constructor(data?: z.infer<typeof CreateFiscalResolutionSchema>) {
    if (data) {
      this.workstationId = data.workstationId;
      this.documentType = data.documentType;
      this.prefix = data.prefix;
      this.rangeStart = data.rangeStart;
      this.rangeEnd = data.rangeEnd;
      this.validFrom = data.validFrom;
      this.validUntil = data.validUntil;
    }
  }
}
