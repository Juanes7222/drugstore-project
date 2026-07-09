export {
  createInventoryAdjustmentsService,
  InventoryAdjustmentsService,
  type AdjustmentItemInput,
  type CreateAdjustmentInput,
  type LotSearchResult,
} from './inventory-adjustments.service';

export {
  AdjustmentNotFoundException,
  AdjustmentNotInDraftException,
  NoLotsForProductException,
  AdjustmentExceedsAvailableStockException,
  AdjustmentLotConflictException,
} from './exceptions';
