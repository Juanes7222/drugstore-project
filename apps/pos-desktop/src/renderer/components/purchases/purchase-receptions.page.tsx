/**
 * Purchase Receptions page — receive inventory against purchase orders.
 *
 * Thin wiring container. Presentational components imported from siblings.
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
  usePurchaseReceptionsService,
  useSuppliersService,
  useProductService,
  usePurchaseOrdersService,
} from '../common/service-context';
import { useAsyncAction } from '../../hooks/use-async-action';
import { usePagination } from '../../hooks/use-pagination';
import type { ReceptionResult, CreateReceptionInput } from '../../../domain/purchases';
import type { SearchableSelectOption } from './searchable-select';

// ── Presentational components (implemented by frontend-pos) ─────────────
import { ReceptionList } from './reception-list';
import { ReceptionForm } from './reception-form';
import { ReceptionDetail } from './reception-detail';

// ── Types ───────────────────────────────────────────────────────────────

type ViewMode = 'list' | 'create' | 'detail';

// ── Page component ──────────────────────────────────────────────────────

export const PurchaseReceptionsPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const receptionsService = usePurchaseReceptionsService();
  const suppliersService = useSuppliersService();
  const ordersService = usePurchaseOrdersService();
  const productService = useProductService();

  // ── Navigation ────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedReceptionId, setSelectedReceptionId] = useState<string | null>(null);

  // ── List ──────────────────────────────────────────────────────────────
  const [receptions, setReceptions] = useState<ReceptionResult[]>([]);
  const { page, total: totalReceptions, setPage, setTotal: setTotalReceptions } = usePagination();
  const {
    isLoading: isLoadingList,
    error: listError,
    run: runListLoad,
  } = useAsyncAction();
  const PAGE_SIZE = 50;

  // ── Create form ───────────────────────────────────────────────────────
  const [formData, setFormData] = useState<CreateReceptionInput>({
    supplierId: '',
    purchaseOrderId: undefined,
    notes: '',
    items: [],
  });
  const {
    isLoading: isSaving,
    error: saveError,
    run: runSave,
    reset: resetSave,
  } = useAsyncAction();

  // ── Detail ────────────────────────────────────────────────────────────
  const [selectedReception, setSelectedReception] = useState<ReceptionResult | null>(null);
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

  // ── Data loading ──────────────────────────────────────────────────────

  const loadReceptions = useCallback(async () => {
    const result = await runListLoad(async () => {
      const res = await receptionsService.listReceptions({ page, pageSize: PAGE_SIZE });
      return res;
    });
    if (result.success) {
      setReceptions(result.data.data);
      setTotalReceptions(result.data.total);
    }
  }, [receptionsService, page, runListLoad, setTotalReceptions]);

  useEffect(() => {
    loadReceptions();
  }, [loadReceptions]);

  // ── Supplier / PO / Product search ──────────────────────────────────
  const [supplierResults, setSupplierResults] = useState<SearchableSelectOption[]>([]);
  const [poResults, setPoResults] = useState<SearchableSelectOption[]>([]);
  const [productResults, setProductResults] = useState<SearchableSelectOption[]>([]);
  const [isSearchingProduct, setIsSearchingProduct] = useState(false);

  const handleSupplierSearch = useCallback(async (query: string) => {
    try {
      const results = await suppliersService.searchSuppliers(query);
      setSupplierResults(
        results.map((s) => ({
          id: s.id,
          label: s.businessName,
          sublabel: s.identificationNumber,
        })),
      );
    } catch {
      setSupplierResults([]);
    }
  }, [suppliersService]);

  const handlePurchaseOrderSearch = useCallback(async (_query: string) => {
    try {
      const result = await ordersService.listOrders({ page: 1, pageSize: 10 });
      setPoResults(
        result.data.map((o) => ({
          id: o.id,
          label: `#${o.id.slice(0, 8)}`,
          sublabel: new Date(o.createdAt).toLocaleDateString(),
        })),
      );
    } catch {
      setPoResults([]);
    }
  }, [ordersService]);

  const handleProductSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setProductResults([]); return; }
    setIsSearchingProduct(true);
    try {
      const result = await productService.listProducts({ query, limit: 20 });
      setProductResults(
        result.items.map((p) => ({
          id: p.id,
          label: p.commercialName,
          sublabel: p.laboratory,
        })),
      );
    } catch {
      setProductResults([]);
    } finally {
      setIsSearchingProduct(false);
    }
  }, [productService]);

  // ── Navigation handlers ───────────────────────────────────────────────

  const handleBack = useCallback(() => {
    if (viewMode === 'detail' || viewMode === 'create') {
      setViewMode('list');
      setSelectedReceptionId(null);
      setSelectedReception(null);
      resetDetail();
      resetConfirm();
      resetAnnul();
    } else {
      dispatch(navigateToPurchasesMain());
    }
  }, [viewMode, dispatch, resetDetail, resetConfirm, resetAnnul]);

  const handleViewReception = useCallback(async (id: string) => {
    setSelectedReceptionId(id);
    const result = await runDetailLoad(async () => {
      const reception = await receptionsService.getReception(id);
      return reception;
    });
    if (result.success) {
      setSelectedReception(result.data);
      setViewMode('detail');
    }
  }, [receptionsService, runDetailLoad]);

  // ── Create form ───────────────────────────────────────────────────────

  const handleCreateClick = useCallback(() => {
    setFormData({
      supplierId: '',
      purchaseOrderId: undefined,
      notes: '',
      items: [],
    });
    resetSave();
    setViewMode('create');
  }, [resetSave]);

  const handleFormChange = useCallback((partial: Partial<CreateReceptionInput>) => {
    setFormData((prev: CreateReceptionInput) => ({ ...prev, ...partial }));
  }, []);

  const handleCreateSubmit = useCallback(async () => {
    const result = await runSave(async () => {
      const created = await receptionsService.createReception(formData);
      return created;
    });
    if (result.success) {
      setSelectedReception(result.data);
      setViewMode('detail');
      await loadReceptions();
    }
  }, [formData, receptionsService, loadReceptions, runSave]);

  // ── Confirm / Annul ───────────────────────────────────────────────────

  const handleConfirmReception = useCallback(async () => {
    if (!selectedReceptionId) return;
    const result = await runConfirm(async () => {
      const updated = await receptionsService.confirmReception(selectedReceptionId);
      return updated;
    });
    if (result.success) {
      setSelectedReception(result.data);
      await loadReceptions();
    }
  }, [selectedReceptionId, receptionsService, loadReceptions, runConfirm]);

  const handleAnnulReception = useCallback(async () => {
    if (!selectedReceptionId) return;
    const result = await runAnnul(async () => {
      const updated = await receptionsService.annulReception(selectedReceptionId);
      return updated;
    });
    if (result.success) {
      setSelectedReception(result.data);
      await loadReceptions();
    }
  }, [selectedReceptionId, receptionsService, loadReceptions, runAnnul]);

  // ── Permissions ───────────────────────────────────────────────────────

  const session = useLocalSessionStore((s) => s.session);
  const canEdit = useMemo(() => {
    if (!session) return false;
    return ['INVENTORY_ASSISTANT', 'ADMIN', 'ACCOUNTANT', 'MANAGER', 'OWNER', 'SAAS_ADMIN'].includes(session.role);
  }, [session]);

  const isDraft = selectedReception?.state === 'DRAFT';
  const canConfirm = canEdit && isDraft;
  const canAnnul = canEdit;

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
              ? t('purchases.receptions.createTitle')
              : viewMode === 'detail'
                ? t('purchases.receptions.detailTitle')
                : t('purchases.receptions.title')}
          </h1>
        </div>
        {viewMode === 'list' && canEdit && (
          <button
            onClick={handleCreateClick}
            className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            + {t('purchases.receptions.create')}
          </button>
        )}
        {viewMode === 'detail' && canConfirm && (
          <button
            onClick={handleConfirmReception}
            disabled={confirmLoading}
            className="px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-sm disabled:opacity-50"
          >
            {confirmLoading ? t('common.processing') : t('purchases.receptions.confirm')}
          </button>
        )}
        {viewMode === 'detail' && canAnnul && (
          <button
            onClick={handleAnnulReception}
            disabled={annulLoading}
            className="px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 text-sm disabled:opacity-50"
          >
            {annulLoading ? t('common.processing') : t('purchases.receptions.annul')}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {viewMode === 'list' && (
          <ReceptionList
            receptions={receptions}
            isLoading={isLoadingList}
            error={listError}
            total={totalReceptions}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            onView={handleViewReception}
          />
        )}

        {viewMode === 'create' && (
          <ReceptionForm
            data={formData}
            onChange={handleFormChange}
            onSubmit={handleCreateSubmit}
            onCancel={() => setViewMode('list')}
            isSaving={isSaving}
            error={saveError}
            suppliers={supplierResults}
            onSupplierSearch={handleSupplierSearch}
            purchaseOrders={poResults}
            onPurchaseOrderSearch={handlePurchaseOrderSearch}
            isSearchingPurchaseOrder={false}
            productResults={productResults}
            onProductSearch={handleProductSearch}
            isSearchingProduct={isSearchingProduct}
          />
        )}

        {viewMode === 'detail' && (
          <ReceptionDetail
            reception={selectedReception}
            isLoading={detailLoading}
            error={detailError || confirmError || annulError}
            onBack={() => setViewMode('list')}
          />
        )}
      </div>
    </div>
  );
};
