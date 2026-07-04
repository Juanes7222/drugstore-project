// Query DTO for pagination and filtering
// Note: Validation is handled by query parameter parsing in NestJS

export class QueryPurchaseReceptionDto {
  page: number = 1;
  pageSize: number = 20;
  supplierId?: string;
  purchaseOrderId?: string;
  state?: string;
  receivedAtFrom?: string;
  receivedAtTo?: string;
}
