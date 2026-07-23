/**
 * Purchase Orders page — create, view, confirm, and annul purchase orders.
 *
 * Thin wiring container with all state/service orchestration.
 * Also manages inline supplier + product creation modals.
 *
 * @category Page
 */

import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/store/hooks';
import { navigateToPurchasesMain } from '@/store/slices/ui-slice';
import { useLocalSessionStore } from '../../../domain/auth/local-session.store';
import {
  useSuppliersService,
  usePurchaseOrdersService,
  usePurchaseReceptionsService,
  useProductService,
} from '../common/service-context';
import { useAsyncAction } from '../../hooks/use-async-action';
import { usePagination } from '../../hooks/use-pagination';
import type {
  PurchaseOrderResult,
  CreatePurchaseOrderInput,
  CreatePurchaseOrderItemInput,
  CreateReceptionItemInput,
  SupplierSearchResult,
} from '../../../domain/purchases';
import type {
  CreateProductInput,
  ProductBarcodeInput,
} from '../../../domain/catalog/product.service';
import type { SupplierIdentificationType, SaleType, PrismaClient } from '@pharmacy/database/local';

// ── Presentational components ───────────────────────────────────────────
import { PurchaseOrderList } from './purchase-order-list';
import { PurchaseOrderForm } from './purchase-order-form';
import { PurchaseOrderDetail } from './purchase-order-detail';
import { formatCOP } from './purchases-helpers';

// ── Types ───────────────────────────────────────────────────────────────

type ViewMode = 'list' | 'create' | 'detail' | 'receive';

export interface OrderFormItem {
  productId: string;
  productName: string;
  requestedQuantity: number;
  expectedUnitCost: number;
}

export interface OrderFormData {
  supplierId: string;
  expectedDeliveryDate: string;
  notes: string;
  items: OrderFormItem[];
}

interface InlineSupplierForm {
  identificationType: SupplierIdentificationType;
  identificationNumber: string;
  businessName: string;
  contactName: string;
  phone: string;
}

interface InlineProductForm {
  commercialName: string;
  laboratory: string;
  barcode: string;
}

interface TaxSchemeOption {
  id: string;
  name: string;
  code: string;
  rate: number;
}

const EMPTY_INLINE_SUPPLIER: InlineSupplierForm = {
  identificationType: 'NIT' as SupplierIdentificationType,
  identificationNumber: '',
  businessName: '',
  contactName: '',
  phone: '',
};

const EMPTY_INLINE_PRODUCT: InlineProductForm = {
  commercialName: '',
  laboratory: '',
  barcode: '',
};

// ── Inline Reception types ───────────────────────────────────────────────

interface ReceiveItemForm {
  productId: string;
  productName: string;
  purchaseOrderItemId: string;
  requestedQuantity: number;
  pendingQuantity: number;
  receivedQuantity: number;
  lotNumber: string;
  expirationDate: string;
  realUnitCost: number;
  taxSchemeId: string;
  taxRate: number;
}

// ── Page component ──────────────────────────────────────────────────────

export const PurchaseOrdersPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const ordersService = usePurchaseOrdersService();
  const receptionsService = usePurchaseReceptionsService();
  const suppliersService = useSuppliersService();
  const productService = useProductService();

  // ── Navigation state ──────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // ── List state ────────────────────────────────────────────────────────
  const [orders, setOrders] = useState<PurchaseOrderResult[]>([]);
  const { page, total: totalOrders, setPage, setTotal: setTotalOrders } = usePagination();
  const {
    isLoading: isLoadingList,
    error: listError,
    run: runListLoad,
  } = useAsyncAction();
  const [filterState, setFilterState] = useState<string | undefined>(undefined);
  const PAGE_SIZE = 50;

  // ── Create form state ─────────────────────────────────────────────────
  const [formData, setFormData] = useState<OrderFormData>({
    supplierId: '',
    expectedDeliveryDate: '',
    notes: '',
    items: [],
  });
  const {
    isLoading: isSaving,
    error: saveError,
    run: runSave,
    reset: resetSave,
  } = useAsyncAction();

  // ── Detail state ──────────────────────────────────────────────────────
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrderResult | null>(null);
  const {
    isLoading: detailLoading,
    error: detailError,
    run: runDetailLoad,
    reset: resetDetail,
  } = useAsyncAction();
  const {
    isLoading: confirmLoading,
    error: confirmError,
    run: runConfirm,
    reset: resetConfirm,
  } = useAsyncAction();
  const {
    isLoading: annulLoading,
    error: annulError,
    run: runAnnul,
    reset: resetAnnul,
  } = useAsyncAction();

  // ── Supplier search for selector ──────────────────────────────────────
  const [suppliers, setSuppliers] = useState<SupplierSearchResult[]>([]);

  // ── Product search for autocomplete ───────────────────────────────────
  const [productResults, setProductResults] = useState<Array<{ id: string; commercialName: string; laboratory: string; barcodes: Array<{ barcode: string }>; currentPrice: string | null }>>([]);
  const [isSearchingProduct, setIsSearchingProduct] = useState(false);

  // ── Inline supplier creation state ────────────────────────────────────
  const [showCreateSupplier, setShowCreateSupplier] = useState(false);
  const [inlineSupplierForm, setInlineSupplierForm] = useState<InlineSupplierForm>(EMPTY_INLINE_SUPPLIER);
  const {
    isLoading: inlineSupplierSaving,
    error: inlineSupplierError,
    run: runInlineSupplierSave,
    reset: resetInlineSupplier,
  } = useAsyncAction();

  // ── Inline product creation state ─────────────────────────────────────
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [inlineProductForm, setInlineProductForm] = useState<InlineProductForm>(EMPTY_INLINE_PRODUCT);
  const {
    isLoading: inlineProductSaving,
    error: inlineProductError,
    run: runInlineProductSave,
    reset: resetInlineProduct,
  } = useAsyncAction();
  const [taxSchemes, setTaxSchemes] = useState<TaxSchemeOption[]>([]);
  const [selectedTaxSchemeId, setSelectedTaxSchemeId] = useState('');

  // ── Data loading ──────────────────────────────────────────────────────

  const loadOrders = useCallback(async () => {
    const result = await runListLoad(async () => {
      return await ordersService.listOrders({
        state: filterState as any,
        page,
        pageSize: PAGE_SIZE,
      });
    });
    if (result.success) {
      setOrders(result.data.data);
      setTotalOrders(result.data.total);
    }
  }, [ordersService, filterState, page, runListLoad, setTotalOrders]);

  const loadSuppliers = useCallback(async (query: string) => {
    try {
      const results = await suppliersService.searchSuppliers(query);
      setSuppliers(results);
    } catch {
      // Silently fail — supplier list is auxiliary
    }
  }, [suppliersService]);

  const handleProductSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setProductResults([]);
      return;
    }
    setIsSearchingProduct(true);
    try {
      const result = await productService.listProducts({ query, limit: 20 });
      setProductResults(result.items.map((item) => ({
        id: item.id,
        commercialName: item.commercialName,
        laboratory: item.laboratory,
        barcodes: item.barcodes,
        currentPrice: item.currentPrice,
      })));
    } catch {
      setProductResults([]);
    } finally {
      setIsSearchingProduct(false);
    }
  }, [productService]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    loadSuppliers('');
  }, [loadSuppliers]);

  // ── Inline Reception state & handlers ──────────────────────────────────
  const [receiveItems, setReceiveItems] = useState<ReceiveItemForm[]>([]);
  const {
    isLoading: isReceiving,
    error: receiveError,
    run: runReceive,
    reset: resetReceive,
  } = useAsyncAction();

  const handleReceiveClick = useCallback(async () => {
    if (!selectedOrderId) return;
    resetReceive();
    try {
      const poData = await receptionsService.getOrderItemsForReception(selectedOrderId);
      setReceiveItems(
        poData.items.map((item) => ({
          productId: item.productId,
          productName: '',
          purchaseOrderItemId: item.purchaseOrderItemId ?? '',
          requestedQuantity: 0,
          pendingQuantity: item.receivedQuantity,
          receivedQuantity: item.receivedQuantity,
          lotNumber: item.lotNumber ?? '',
          expirationDate: item.expirationDate ?? '',
          realUnitCost: item.realUnitCost,
          taxSchemeId: item.taxSchemeId,
          taxRate: item.taxRate,
        })),
      );
      setViewMode('receive');
    } catch (err) {
      console.error('Failed to load PO items for reception:', err);
    }
  }, [selectedOrderId, receptionsService, resetReceive]);

  const handleReceiveItemChange = useCallback(
    (index: number, partial: Partial<ReceiveItemForm>) => {
      setReceiveItems((prev) => {
        const items = [...prev];
        items[index] = { ...items[index], ...partial };
        return items;
      });
    },
    [],
  );

  const handleConfirmReception = useCallback(async () => {
    if (!selectedOrderId || !selectedOrder) return;

    const result = await runReceive(async () => {
      // Build CreateReceptionInput from receiveItems
      const receptionInput = {
        supplierId: selectedOrder.supplierId,
        purchaseOrderId: selectedOrderId,
        notes: '',
        items: receiveItems.map(
          (item): CreateReceptionItemInput => ({
            productId: item.productId,
            purchaseOrderItemId: item.purchaseOrderItemId,
            receivedQuantity: item.receivedQuantity,
            lotNumber: item.lotNumber || undefined,
            expirationDate: item.expirationDate || undefined,
            realUnitCost: item.realUnitCost,
            taxSchemeId: item.taxSchemeId,
            taxRate: item.taxRate,
            discountAmount: 0,
          }),
        ),
      };

      // Create reception in DRAFT
      const created = await receptionsService.createReception(receptionInput);
      // Confirm it — this updates stock + PO state
      const confirmed = await receptionsService.confirmReception(created.id);
      return confirmed;
    });

    if (result.success) {
      // Refresh order detail to show updated state
      const updatedOrder = await ordersService.getOrder(selectedOrderId);
      setSelectedOrder(updatedOrder);
      setViewMode('detail');
      await loadOrders();
    }
  }, [selectedOrderId, selectedOrder, receiveItems, ordersService, receptionsService, runReceive]);

  const handleCancelReception = useCallback(() => {
    setViewMode('detail');
    resetReceive();
  }, [resetReceive]);

  // ── Navigation handlers ───────────────────────────────────────────────

  const handleBack = useCallback(() => {
    if (viewMode === 'detail' || viewMode === 'create' || viewMode === 'receive') {
      setViewMode(viewMode === 'receive' ? 'detail' : 'list');
      if (viewMode === 'receive') {
        resetReceive();
      } else {
        setSelectedOrderId(null);
        setSelectedOrder(null);
      }
      resetDetail();
      resetConfirm();
      resetAnnul();
    } else {
      dispatch(navigateToPurchasesMain());
    }
  }, [viewMode, dispatch, resetDetail, resetConfirm, resetAnnul, resetReceive]);

  const handleViewOrder = useCallback(async (id: string) => {
    setSelectedOrderId(id);
    const result = await runDetailLoad(async () => {
      return await ordersService.getOrder(id);
    });
    if (result.success) {
      setSelectedOrder(result.data);
      setViewMode('detail');
    }
  }, [ordersService, runDetailLoad]);

  // ── Create form handlers ──────────────────────────────────────────────

  const handleCreateClick = useCallback(() => {
    setFormData({
      supplierId: '',
      expectedDeliveryDate: '',
      notes: '',
      items: [],
    });
    resetSave();
    setViewMode('create');
  }, [resetSave]);

  const handleAddItem = useCallback((item: OrderFormItem) => {
    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, item],
    }));
  }, []);

  const handleRemoveItem = useCallback((index: number) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  }, []);

  const handleItemChange = useCallback((index: number, partial: Partial<OrderFormItem>) => {
    setFormData((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], ...partial };
      return { ...prev, items };
    });
  }, []);

  const handleCreateSubmit = useCallback(async () => {
    const result = await runSave(async () => {
      const input: CreatePurchaseOrderInput = {
        supplierId: formData.supplierId,
        expectedDeliveryDate: formData.expectedDeliveryDate || undefined,
        notes: formData.notes || undefined,
        items: formData.items.map((item): CreatePurchaseOrderItemInput => ({
          productId: item.productId,
          requestedQuantity: item.requestedQuantity,
          expectedUnitCost: item.expectedUnitCost,
        })),
      };
      return await ordersService.createOrder(input);
    });
    if (result.success) {
      setSelectedOrder(result.data);
      setViewMode('detail');
      await loadOrders();
    }
  }, [formData, ordersService, loadOrders, runSave]);

  // ── Inline supplier creation ─────────────────────────────────────────

  const handleOpenCreateSupplier = useCallback(() => {
    setInlineSupplierForm(EMPTY_INLINE_SUPPLIER);
    resetInlineSupplier();
    setShowCreateSupplier(true);
  }, [resetInlineSupplier]);

  const handleCreateSupplierSubmit = useCallback(async () => {
    const result = await runInlineSupplierSave(async () => {
      const created = await suppliersService.createSupplier({
        identificationType: inlineSupplierForm.identificationType,
        identificationNumber: inlineSupplierForm.identificationNumber,
        businessName: inlineSupplierForm.businessName,
        contactName: inlineSupplierForm.contactName || undefined,
        phone: inlineSupplierForm.phone || undefined,
      });
      return created;
    });
    if (result.success) {
      setFormData((prev) => ({ ...prev, supplierId: result.data.id }));
      setShowCreateSupplier(false);
      await loadSuppliers('');
    }
  }, [inlineSupplierForm, suppliersService, loadSuppliers, runInlineSupplierSave]);

  // ── Inline product creation ───────────────────────────────────────────

  const handleOpenCreateProduct = useCallback(async () => {
    setInlineProductForm(EMPTY_INLINE_PRODUCT);
    resetInlineProduct();
    setSelectedTaxSchemeId('');
    // Load tax schemes for the dropdown
    try {
      const { getLocalDatabase } = await import(
        '../../../infrastructure/local-database'
      );
      const { prisma } = await getLocalDatabase();
      const db = prisma as PrismaClient;
      const rows = await db.taxScheme.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, code: true, rate: true },
      });
      setTaxSchemes(rows as unknown as TaxSchemeOption[]);
      if (rows.length > 0) {
        setSelectedTaxSchemeId(rows[0].id);
      }
    } catch {
      setTaxSchemes([]);
    }
    setShowCreateProduct(true);
  }, []);

  const handleCreateProductSubmit = useCallback(async () => {
    const result = await runInlineProductSave(async () => {
      const barcodeValue = inlineProductForm.barcode.trim()
        || `INT-${globalThis.crypto.randomUUID().slice(0, 8).toUpperCase()}`;

      const barcodes: ProductBarcodeInput[] = [{
        barcode: barcodeValue,
        barcodeType: 'INTERNAL',
        isPrimary: true,
      }];

      const input: CreateProductInput = {
        commercialName: inlineProductForm.commercialName,
        genericName: inlineProductForm.commercialName,
        activePrinciple: inlineProductForm.commercialName,
        laboratory: inlineProductForm.laboratory,
        saleType: 'OTC' as SaleType,
        barcodes,
        price: { price: 0 },
        tax: { taxSchemeId: selectedTaxSchemeId || taxSchemes[0]?.id || '' },
      };

      const created = (await productService.createProduct(input)) as { id: string; commercialName?: string };
      return created;
    });
    if (result.success) {
      const created = result.data;
      const productId = created?.id || '';
      const productName = inlineProductForm.commercialName;

      const newItem: OrderFormItem = {
        productId,
        productName,
        requestedQuantity: 1,
        expectedUnitCost: 0,
      };
      setFormData((prev) => ({
        ...prev,
        items: [...prev.items, newItem],
      }));
      setShowCreateProduct(false);
    }
  }, [inlineProductForm, selectedTaxSchemeId, taxSchemes, productService, runInlineProductSave]);

  // ── Confirm / Annul handlers ──────────────────────────────────────────

  const handleConfirmOrder = useCallback(async () => {
    if (!selectedOrderId) return;
    const result = await runConfirm(async () => {
      return await ordersService.confirmOrder(selectedOrderId);
    });
    if (result.success) {
      setSelectedOrder(result.data);
      await loadOrders();
    }
  }, [selectedOrderId, ordersService, loadOrders, runConfirm]);

  const handleAnnulOrder = useCallback(async () => {
    if (!selectedOrderId) return;
    const result = await runAnnul(async () => {
      return await ordersService.annulOrder(selectedOrderId);
    });
    if (result.success) {
      setSelectedOrder(result.data);
      await loadOrders();
    }
  }, [selectedOrderId, ordersService, loadOrders, runAnnul]);

  // ── Role / permissions ────────────────────────────────────────────────

  const session = useLocalSessionStore((s) => s.session);
  const canEdit = useMemo(() => {
    if (!session) return false;
    return ['INVENTORY_ASSISTANT', 'ADMIN', 'ACCOUNTANT', 'MANAGER', 'OWNER', 'SAAS_ADMIN'].includes(session.role);
  }, [session]);

  const isDraft = selectedOrder?.state === 'DRAFT';
  const isConfirmed = selectedOrder?.state === 'CONFIRMED';
  const canConfirm = canEdit && isDraft;
  const canAnnul = canEdit && (isDraft || isConfirmed);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="text-gray-600 hover:text-gray-900"
            aria-label={t('common.back')}
          >
            ←
          </button>
          <h1 className="text-lg font-semibold">
            {viewMode === 'create'
              ? t('purchases.orders.createTitle')
              : viewMode === 'detail'
                ? t('purchases.orders.detailTitle')
                : viewMode === 'receive'
                  ? t('purchases.orders.receive')
                  : t('purchases.orders.title')}
          </h1>
        </div>
        {viewMode === 'list' && canEdit && (
          <button
            onClick={handleCreateClick}
            className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            + {t('purchases.orders.create')}
          </button>
        )}
        {viewMode === 'detail' && canConfirm && (
          <button
            onClick={handleConfirmOrder}
            disabled={confirmLoading}
            className="px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-sm disabled:opacity-50"
          >
            {confirmLoading ? t('common.processing') : t('purchases.orders.confirm')}
          </button>
        )}
        {viewMode === 'detail' && canAnnul && (
          <button
            onClick={handleAnnulOrder}
            disabled={annulLoading}
            className="px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 text-sm disabled:opacity-50"
          >
            {annulLoading ? t('common.processing') : t('purchases.orders.annul')}
          </button>
        )}
        {viewMode === 'receive' && (
          <button
            onClick={handleConfirmReception}
            disabled={isReceiving}
            className="px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-sm disabled:opacity-50"
          >
            {isReceiving ? t('common.processing') : t('purchases.receptions.confirm')}
          </button>
        )}
        {viewMode === 'detail' && (isConfirmed || selectedOrder?.state === 'PARTIALLY_RECEIVED') && selectedOrderId && (
          <button
            onClick={handleReceiveClick}
            className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm flex items-center gap-1"
          >
            {t('purchases.orders.receive')}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {viewMode === 'list' && (
          <PurchaseOrderList
            orders={orders}
            isLoading={isLoadingList}
            error={listError}
            total={totalOrders}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            onView={handleViewOrder}
            filterState={filterState}
            onFilterStateChange={setFilterState}
          />
        )}

        {viewMode === 'create' && (
          <PurchaseOrderForm
            data={formData}
            onChange={setFormData}
            suppliers={suppliers}
            onSupplierSearch={loadSuppliers}
            productResults={productResults}
            onProductSearch={handleProductSearch}
            isSearchingProduct={isSearchingProduct}
            onAddItem={handleAddItem}
            onRemoveItem={handleRemoveItem}
            onItemChange={handleItemChange}
            onSubmit={handleCreateSubmit}
            onCancel={() => setViewMode('list')}
            isSaving={isSaving}
            error={saveError}
            onCreateSupplier={canEdit ? handleOpenCreateSupplier : undefined}
            onCreateProduct={canEdit ? handleOpenCreateProduct : undefined}
          />
        )}

        {viewMode === 'detail' && (
          <PurchaseOrderDetail
            order={selectedOrder}
            isLoading={detailLoading}
            error={detailError || confirmError || annulError}
            onBack={() => setViewMode('list')}
          />
        )}

        {viewMode === 'receive' && selectedOrder && (
          <div className="max-w-4xl mx-auto">
            {/* Reception header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="pos-page-title">
                  {t('purchases.orders.receive')} — #{selectedOrder.sequentialNumber}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {selectedOrder.supplier.businessName}
                </p>
              </div>
              <button
                onClick={handleCancelReception}
                disabled={isReceiving}
                className="pos-button pos-button-secondary text-sm"
              >
                {t('common.cancel')}
              </button>
            </div>

            {/* Error banner */}
            {receiveError && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm border border-red-200" role="alert">
                {receiveError}
              </div>
            )}

            {/* Items */}
            <div className="space-y-4 mb-6">
              {receiveItems.map((item, i) => (
                <div key={i} className="pos-panel p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-700">
                      {item.productId}
                    </span>
                    <span className="text-xs text-gray-500">
                      {t('purchases.orders.requestedQty')}: {item.requestedQuantity}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">
                        {t('purchases.receptions.qtyReceived')}
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={item.receivedQuantity}
                        onChange={(e) => handleReceiveItemChange(i, { receivedQuantity: Math.max(0, Number(e.target.value)) })}
                        disabled={isReceiving}
                        className="pos-input text-sm font-data tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">
                        {t('purchases.receptions.lotNumber')}
                      </label>
                      <input
                        type="text"
                        value={item.lotNumber}
                        onChange={(e) => handleReceiveItemChange(i, { lotNumber: e.target.value })}
                        disabled={isReceiving}
                        className="pos-input text-sm font-data"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">
                        {t('purchases.receptions.expirationDate')}
                      </label>
                      <input
                        type="date"
                        value={item.expirationDate}
                        onChange={(e) => handleReceiveItemChange(i, { expirationDate: e.target.value })}
                        disabled={isReceiving}
                        className="pos-input text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">
                        {t('purchases.receptions.unitCost')}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={item.realUnitCost}
                        onChange={(e) => handleReceiveItemChange(i, { realUnitCost: Math.max(0, Number(e.target.value)) })}
                        disabled={isReceiving}
                        className="pos-input text-sm font-data tabular-nums"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className="flex justify-end py-3 border-t border-gray-200">
              <div className="text-right">
                <span className="text-sm text-gray-500">{t('purchases.receptions.totalAmount')}: </span>
                <span className="text-base font-bold font-data tabular-nums">
                  {formatCOP(receiveItems.reduce((sum, item) => sum + item.receivedQuantity * item.realUnitCost, 0))}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={handleCancelReception}
                disabled={isReceiving}
                className="pos-button pos-button-secondary"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmReception}
                disabled={isReceiving || receiveItems.length === 0}
                className="pos-button pos-button-primary"
              >
                {isReceiving ? t('common.processing') : t('purchases.receptions.confirm')}
              </button>
            </div>
          </div>
        )}
      </div>
      {/* ── Inline Supplier Creation Modal ─────────────────────────────── */}
      {showCreateSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowCreateSupplier(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="text-base font-semibold">{t('purchases.orders.createSupplier')}</h2>
            </div>
            <div className="p-4 space-y-3">
              {inlineSupplierError && (
                <div className="p-2 bg-red-50 text-red-700 rounded text-xs border border-red-200" role="alert">
                  {inlineSupplierError}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">
                  {t('purchases.suppliers.identificationType')}
                </label>
                <select
                  value={inlineSupplierForm.identificationType}
                  onChange={(e) => setInlineSupplierForm((p) => ({ ...p, identificationType: e.target.value as SupplierIdentificationType }))}
                  disabled={inlineSupplierSaving}
                  className="pos-input text-sm"
                >
                  <option value="NIT">NIT</option>
                  <option value="CC">Cédula de Ciudadanía</option>
                  <option value="CE">Cédula de Extranjería</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">
                  {t('purchases.suppliers.identificationNumber')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={inlineSupplierForm.identificationNumber}
                  onChange={(e) => setInlineSupplierForm((p) => ({ ...p, identificationNumber: e.target.value }))}
                  disabled={inlineSupplierSaving}
                  className="pos-input text-sm"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">
                  {t('purchases.suppliers.businessName')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={inlineSupplierForm.businessName}
                  onChange={(e) => setInlineSupplierForm((p) => ({ ...p, businessName: e.target.value }))}
                  disabled={inlineSupplierSaving}
                  className="pos-input text-sm"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">
                  {t('purchases.suppliers.contactName')}
                </label>
                <input
                  type="text"
                  value={inlineSupplierForm.contactName}
                  onChange={(e) => setInlineSupplierForm((p) => ({ ...p, contactName: e.target.value }))}
                  disabled={inlineSupplierSaving}
                  className="pos-input text-sm"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">
                  {t('purchases.suppliers.phone')}
                </label>
                <input
                  type="text"
                  value={inlineSupplierForm.phone}
                  onChange={(e) => setInlineSupplierForm((p) => ({ ...p, phone: e.target.value }))}
                  disabled={inlineSupplierSaving}
                  className="pos-input text-sm"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowCreateSupplier(false)}
                disabled={inlineSupplierSaving}
                className="pos-button pos-button-secondary text-sm"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleCreateSupplierSubmit}
                disabled={inlineSupplierSaving || !inlineSupplierForm.identificationNumber.trim() || !inlineSupplierForm.businessName.trim()}
                className="pos-button pos-button-primary text-sm"
              >
                {inlineSupplierSaving ? t('common.processing') : t('common.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Inline Product Creation Modal ──────────────────────────────── */}
      {showCreateProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowCreateProduct(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="text-base font-semibold">{t('purchases.orders.createProduct')}</h2>
            </div>
            <div className="p-4 space-y-3">
              {inlineProductError && (
                <div className="p-2 bg-red-50 text-red-700 rounded text-xs border border-red-200" role="alert">
                  {inlineProductError}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">
                  {t('purchases.orders.productName')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={inlineProductForm.commercialName}
                  onChange={(e) => setInlineProductForm((p) => ({ ...p, commercialName: e.target.value }))}
                  disabled={inlineProductSaving}
                  className="pos-input text-sm"
                  autoComplete="off"
                  placeholder={t('purchases.orders.productNamePlaceholder')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">
                  {t('purchases.orders.laboratory')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={inlineProductForm.laboratory}
                  onChange={(e) => setInlineProductForm((p) => ({ ...p, laboratory: e.target.value }))}
                  disabled={inlineProductSaving}
                  className="pos-input text-sm"
                  autoComplete="off"
                  placeholder={t('purchases.orders.laboratoryPlaceholder')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">
                  {t('purchases.orders.barcode')}
                </label>
                <input
                  type="text"
                  value={inlineProductForm.barcode}
                  onChange={(e) => setInlineProductForm((p) => ({ ...p, barcode: e.target.value }))}
                  disabled={inlineProductSaving}
                  className="pos-input text-sm"
                  autoComplete="off"
                  placeholder={t('purchases.orders.barcodePlaceholder')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">
                  {t('purchases.orders.taxScheme')} <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedTaxSchemeId}
                  onChange={(e) => setSelectedTaxSchemeId(e.target.value)}
                  disabled={inlineProductSaving || taxSchemes.length === 0}
                  className="pos-input text-sm"
                >
                  {taxSchemes.length === 0 && (
                    <option value="">{t('common.loading')}</option>
                  )}
                  {taxSchemes.map((ts) => (
                    <option key={ts.id} value={ts.id}>
                      {ts.name} ({ts.code} — {ts.rate}%)
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowCreateProduct(false)}
                disabled={inlineProductSaving}
                className="pos-button pos-button-secondary text-sm"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleCreateProductSubmit}
                disabled={inlineProductSaving || !inlineProductForm.commercialName.trim() || !inlineProductForm.laboratory.trim() || !selectedTaxSchemeId}
                className="pos-button pos-button-primary text-sm"
              >
                {inlineProductSaving ? t('common.processing') : t('common.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
