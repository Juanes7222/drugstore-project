// Query DTO for pagination and filtering
import { Type } from 'class-transformer';

export class QueryFiscalDocumentsDto {
  @Type(() => Number)
  page: number = 1;

  @Type(() => Number)
  pageSize: number = 20;

  // When present, wins over page/pageSize: keyset walk over (issueDate, id).
  cursor?: string;

  state?: string;
  documentType?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
}
