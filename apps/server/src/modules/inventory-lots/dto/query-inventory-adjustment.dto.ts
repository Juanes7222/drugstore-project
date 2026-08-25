// Query DTO for pagination and filtering
import { Type } from 'class-transformer';

export class QueryInventoryAdjustmentDto {
  @Type(() => Number)
  page: number = 1;

  @Type(() => Number)
  pageSize: number = 20;

  // When present, wins over page/pageSize: keyset walk over the list's time field.
  cursor?: string;

  state?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
}
