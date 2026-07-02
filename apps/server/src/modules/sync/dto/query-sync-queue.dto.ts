// Query DTO for pagination and filtering
// Note: Validation is handled by query parameter parsing in NestJS

export class QuerySyncQueueDto {
  page: number = 1;
  pageSize: number = 20;
  status?: string;
  operationType?: string;
}
