import { Type } from 'class-transformer';

export class QuerySupplierReturnDto {
  @Type(() => Number)
  page: number = 1;

  @Type(() => Number)
  pageSize: number = 20;

  // When present, wins over page/pageSize: keyset walk over the list's time field.
  cursor?: string;

  supplierId?: string;
  purchaseReceptionId?: string;
  state?: string;
}
