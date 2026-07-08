// Query DTO for pagination and filtering
// Note: Validation is handled by query parameter parsing in NestJS

export class QueryClientDto {
  page: number = 1;
  pageSize: number = 20;
  search?: string;
  municipality?: string;
  classificationId?: string;
  /** ISO-8601 timestamp — only return clients updated after this point. */
  since?: string;
}
