// Query DTO for pagination and filtering
// Note: Validation is handled by query parameter parsing in NestJS

export class QueryLotDto {
  page: number = 1;
  pageSize: number = 20;
  productId?: string;
  state?: string;
  expiresAtFrom?: string;
  expiresAtTo?: string;
}
