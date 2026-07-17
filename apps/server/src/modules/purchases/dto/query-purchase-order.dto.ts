// Query DTO for pagination and filtering
import { Type } from 'class-transformer';

export class QueryPurchaseOrderDto {
  @Type(() => Number)
  page: number = 1;

  @Type(() => Number)
  pageSize: number = 20;

  supplierId?: string;
  state?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
}
