// Query DTO for pagination and filtering
import { Type } from 'class-transformer';

export class QueryClientDto {
  @Type(() => Number)
  page: number = 1;

  @Type(() => Number)
  pageSize: number = 20;

  // When present, wins over page/pageSize: keyset walk over (updatedAt, id).
  cursor?: string;

  search?: string;
  municipality?: string;
  classificationId?: string;
  /** ISO-8601 timestamp — only return clients updated after this point. */
  since?: string;
}
