// Query DTO for pagination and filtering
import { Type } from 'class-transformer';

export class QueryProductDto {
  @Type(() => Number)
  page: number = 1;

  @Type(() => Number)
  pageSize: number = 20;

  search?: string;
  categoryId?: string;
  isFreeToSale?: boolean;
}
