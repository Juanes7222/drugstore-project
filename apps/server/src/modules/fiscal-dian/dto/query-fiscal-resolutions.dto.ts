// Query DTO for pagination and filtering
import { Type } from 'class-transformer';

export class QueryFiscalResolutionsDto {
  @Type(() => Number)
  page: number = 1;

  @Type(() => Number)
  pageSize: number = 20;

  state?: string;
}
