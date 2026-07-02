// Query DTO for pagination and filtering
// Note: Validation is handled by query parameter parsing in NestJS

export class QueryInventoryMovementDto {
  page: number = 1;
  pageSize: number = 20;
  movementType?: string;
  lotId?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
}
