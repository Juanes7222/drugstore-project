import { Type } from 'class-transformer';

export class QuerySupplierReturnDto {
  @Type(() => Number)
  page: number = 1;

  @Type(() => Number)
  pageSize: number = 20;

  supplierId?: string;
  purchaseReceptionId?: string;
  state?: string;
}
