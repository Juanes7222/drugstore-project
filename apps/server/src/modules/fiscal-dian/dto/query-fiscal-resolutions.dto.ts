// Query DTO for pagination and filtering
// Note: Validation is handled by query parameter parsing in NestJS

export class QueryFiscalResolutionsDto {
  page: number = 1;
  pageSize: number = 20;
  state?: string;
}
