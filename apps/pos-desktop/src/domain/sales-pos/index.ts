export {
  SalesPosService,
  createSalesPosService,
  type ConfirmResult,
  type CreateSaleItemInput,
  type CreateSaleInput,
  type PaymentInput,
  type ConfirmSaleInput,
} from './sales-pos.service';

export {
  createSalesHistoryService,
  type SalesHistoryService,
  type SalesHistoryServiceConfig,
  type SaleHistoryListItem,
  type SaleHistoryListResult,
  type SaleHistoryFilters,
  type SaleHistoryDetail,
  type SaleHistoryItem,
  type SaleHistoryPayment,
} from './sales-history.service';

export {
  SaleNotInProgressException,
  PrescriptionRequiredNotSupportedException,
  PaymentAmountMismatchException,
  ChangeRequiresCashPaymentException,
  SaleNotFoundException,
  DiscountExceedsRoleLimitException,
  PriceOverrideNotAllowedForRoleException,
  PriceBelowCostException,
  ProductNotSyncedYetException,
} from './exceptions';

export {
  validateItemPricing,
  validateSalePricing,
  resolveDiscountLimitKey,
  resolvePriceOverrideRoleKey,
  type DiscountLimitKey,
  type PriceOverrideRoleKey,
} from './sales-pricing-validator';

export { createSalesSyncService, SalesSyncService } from './sales-sync.service';

export {
  calculateCommission,
  isCommissionWindowActive,
  type CommissionConfigInput,
  type CommissionCalculationInput,
  type CommissionCalculationResult,
} from './commission';
