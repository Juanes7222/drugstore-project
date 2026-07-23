/**
 * Purchases domain — suppliers, purchase orders, receptions, and supplier
 * returns for the offline-first POS desktop app.
 */
export {
  createSuppliersService,
  type SuppliersService,
  type SupplierSearchResult,
  type CreateSupplierInput,
  type UpdateSupplierInput,
} from './suppliers.service';
export {
  createPurchaseOrdersService,
  type PurchaseOrdersService,
  type PurchaseOrderResult,
  type CreatePurchaseOrderInput,
  type CreatePurchaseOrderItemInput,
} from './purchase-orders.service';
export {
  createPurchaseReceptionsService,
  type PurchaseReceptionsService,
  type ReceptionResult,
  type CreateReceptionInput,
  type CreateReceptionItemInput,
} from './purchase-receptions.service';
export {
  createSupplierReturnsService,
  type SupplierReturnsService,
  type SupplierReturnResult,
  type CreateSupplierReturnInput,
} from './supplier-returns.service';

export {
  SupplierNotFoundException,
  DuplicateSupplierIdentificationException,
  PurchaseOrderNotFoundException,
  PurchaseOrderNotDraftException,
  PurchaseOrderNotConfirmableException,
  PurchaseReceptionNotFoundException,
  PurchaseReceptionNotDraftException,
  PurchaseReceptionNotConfirmedException,
  OverReceptionException,
  PurchaseOrderItemNotFoundException,
  PurchaseOrderItemMismatchException,
  SupplierReturnNotFoundException,
  SupplierReturnNotDraftException,
  SupplierReturnCannotBeAnnulledException,
  SupplierReturnLotCostUnavailableException,
  LotNotFoundException,
  ConcurrentStockModificationException,
} from './exceptions';
