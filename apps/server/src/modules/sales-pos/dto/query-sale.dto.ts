// Query DTO for pagination and filtering
// Note: Validation is handled by query parameter parsing in NestJS

export class QuerySaleDto {
  page: number = 1;
  pageSize: number = 20;
  cashShiftId?: string;
  clientId?: string;
  operationalState?: string;
  workstationId?: string;
  state?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
  confirmedAtFrom?: string;
  confirmedAtTo?: string;
}
