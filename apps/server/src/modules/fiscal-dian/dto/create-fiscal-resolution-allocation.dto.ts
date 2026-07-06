import { z } from 'zod';

/**
 * Schema for creating a FiscalResolutionAllocation.
 * rangeFrom and rangeTo are validated against the parent resolution and
 * against other allocations from the same resolution in the service layer.
 */
export const CreateFiscalResolutionAllocationSchema = z.object({
  resolutionId: z.string().uuid('Invalid resolution UUID'),
  workstationId: z.string().uuid('Invalid workstation UUID'),
  rangeFrom: z.number().int().positive('Range start must be a positive integer'),
  rangeTo: z.number().int().positive('Range end must be a positive integer'),
});

export type CreateFiscalResolutionAllocationInput = z.infer<
  typeof CreateFiscalResolutionAllocationSchema
>;

export class CreateFiscalResolutionAllocationDto
  implements z.infer<typeof CreateFiscalResolutionAllocationSchema>
{
  resolutionId!: string;
  workstationId!: string;
  rangeFrom!: number;
  rangeTo!: number;

  constructor(data?: CreateFiscalResolutionAllocationInput) {
    if (data) {
      this.resolutionId = data.resolutionId;
      this.workstationId = data.workstationId;
      this.rangeFrom = data.rangeFrom;
      this.rangeTo = data.rangeTo;
    }
  }
}
