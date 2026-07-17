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
  type CreateProductInput,
  type CreateProductPriceInput,
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
} from './exceptions';
