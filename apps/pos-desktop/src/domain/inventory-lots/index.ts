export {
  createInventoryLotsService,
  InventoryLotsService,
  type ConsumeStockForSaleParams,
  type ConsumedLot,
} from './inventory-lots.service';

export {
  createLotSyncService,
  LotSyncService,
  LotSyncHttpError,
  type LotSyncConfig,
} from './lot-sync.service';

export {
  InsufficientStockException,
  ConcurrentStockModificationException,
} from './exceptions';
