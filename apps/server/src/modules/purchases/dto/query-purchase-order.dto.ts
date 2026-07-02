// Query DTO for pagination and filtering
// Note: Validation is handled by query parameter parsing in NestJS

export class QueryPurchaseOrderDto {
  page: number = 1;
  pageSize: number = 20;
  supplierId?: string;
  state?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
}
