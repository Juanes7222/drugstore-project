// Query DTO for pagination and filtering
import { Type } from 'class-transformer';

export class QueryPurchaseReceptionDto {
  @Type(() => Number)
  page: number = 1;

  @Type(() => Number)
  pageSize: number = 20;

  // When present, wins over page/pageSize: keyset walk over the list's time field.
  cursor?: string;

  supplierId?: string;
  purchaseOrderId?: string;
  state?: string;
  receivedAtFrom?: string;
  receivedAtTo?: string;
}
