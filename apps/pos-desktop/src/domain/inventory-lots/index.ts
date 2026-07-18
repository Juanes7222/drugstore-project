export {
  createInventoryLotsService,
  InventoryLotsService,
  type ConsumeStockForSaleParams,
  type ConsumedLot,
  type LotMovementRecord,
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
