// Query DTO for pagination and filtering
// Note: Validation is handled by query parameter parsing in NestJS

export class QuerySupplierDto {
  page: number = 1;
  pageSize: number = 20;
  search?: string;
  country?: string;
}
