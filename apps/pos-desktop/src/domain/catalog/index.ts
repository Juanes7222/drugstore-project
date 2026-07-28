export {
  createCatalogSyncService,
  CatalogSyncService,
  CatalogSyncHttpError,
  type CatalogSyncConfig,
  type SyncHttpClient,
} from './catalog-sync.service';

export {
  createProductService,
  ProductService,
  requireServerReferenceId,
  sanitizeOptionalReferenceId,
  type CreateProductInput,
  type CreateProductPriceInput,
  type CreateProductCostInput,
  type CreateProductTaxInput,
  type UpdateProductInput,
  type ProductBarcodeInput,
  type ProductListItem,
  type ProductSearchResult,
} from './product.service';

export {
  ProductNotFoundException,
  ProductCreationException,
  ProductUpdateException,
  DuplicateBarcodeException,
  UnsyncedReferenceException,
} from './exceptions';
