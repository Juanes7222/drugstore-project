// Query DTO for pagination and filtering
// Note: Validation is handled by query parameter parsing in NestJS

export class QueryInventoryAdjustmentDto {
  page: number = 1;
  pageSize: number = 20;
  state?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
}
