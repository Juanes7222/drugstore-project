export class QuerySupplierReturnDto {
  page: number = 1;
  pageSize: number = 20;
  supplierId?: string;
  purchaseReceptionId?: string;
  state?: string;
}
