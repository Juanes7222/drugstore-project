// Query DTO for pagination and filtering
// Note: Validation is handled by query parameter parsing in NestJS

export class QueryFiscalDocumentsDto {
  page: number = 1;
  pageSize: number = 20;
  state?: string;
  documentType?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
}
