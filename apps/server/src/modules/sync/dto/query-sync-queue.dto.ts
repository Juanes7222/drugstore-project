// Query DTO for pagination and filtering
import { Type } from 'class-transformer';

export class QuerySyncQueueDto {
  @Type(() => Number)
  page: number = 1;

  @Type(() => Number)
  pageSize: number = 20;

  status?: string;
  operationType?: string;
}
