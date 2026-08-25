// Query DTO for pagination and filtering
import { Type } from 'class-transformer';

export class QueryInventoryMovementDto {
  @Type(() => Number)
  page: number = 1;

  @Type(() => Number)
  pageSize: number = 20;

  // When present, wins over page/pageSize: keyset walk over (createdAt, id).
  cursor?: string;

  movementType?: string;
  lotId?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
}
