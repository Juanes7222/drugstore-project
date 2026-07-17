// Query DTO for pagination and filtering
import { Type } from 'class-transformer';

export class QueryLotDto {
  @Type(() => Number)
  page: number = 1;

  @Type(() => Number)
  pageSize: number = 20;

  productId?: string;
  state?: string;
  expiresAtFrom?: string;
  expiresAtTo?: string;
}
