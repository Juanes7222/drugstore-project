// Query DTO for pagination and filtering
import { Type } from 'class-transformer';

export class QueryInventoryMovementDto {
  @Type(() => Number)
  page: number = 1;

  @Type(() => Number)
  pageSize: number = 20;

  movementType?: string;
  lotId?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
}
