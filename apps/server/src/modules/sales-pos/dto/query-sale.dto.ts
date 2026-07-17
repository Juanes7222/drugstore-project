// Query DTO for pagination and filtering
import { Type } from 'class-transformer';

export class QuerySaleDto {
  @Type(() => Number)
  page: number = 1;

  @Type(() => Number)
  pageSize: number = 20;

  cashShiftId?: string;
  clientId?: string;
  operationalState?: string;
  workstationId?: string;
  state?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
  confirmedAtFrom?: string;
  confirmedAtTo?: string;
}
