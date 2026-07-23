/**
 * Supplier Returns page — return goods to supplier.
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
  useSupplierReturnsService,
  useSuppliersService,
  useProductService,
  usePurchaseReceptionsService,
} from '../common/service-context';
import { useAsyncAction } from '../../hooks/use-async-action';
import { usePagination } from '../../hooks/use-pagination';
import type { SupplierReturnResult, CreateSupplierReturnInput } from '../../../domain/purchases';
import type { SearchableSelectOption } from './searchable-select';

// ── Presentational components (implemented by frontend-pos) ─────────────
import { SupplierReturnList } from './supplier-return-list';
import { SupplierReturnForm } from './supplier-return-form';
import { SupplierReturnDetail } from './supplier-return-detail';

// ── Types ───────────────────────────────────────────────────────────────

type ViewMode = 'list' | 'create' | 'detail';

// ── Page component ──────────────────────────────────────────────────────

export const SupplierReturnsPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const returnsService = useSupplierReturnsService();
  const suppliersService = useSuppliersService();
  const receptionsService = usePurchaseReceptionsService();
  const productService = useProductService();

  // ── Navigation ────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedReturnId, setSelectedReturnId] = useState<string | null>(null);

  // ── List ──────────────────────────────────────────────────────────────
  const [returns, setReturns] = useState<SupplierReturnResult[]>([]);
  const { page, total: totalReturns, setPage, setTotal: setTotalReturns } = usePagination();
  const {
    isLoading: isLoadingList,
    error: listError,
    run: runListLoad,
  } = useAsyncAction();
  const PAGE_SIZE = 50;

  // ── Create form ───────────────────────────────────────────────────────
  const [formData, setFormData] = useState<CreateSupplierReturnInput>({
    supplierId: '',
    purchaseReceptionId: undefined,
    reason: '',
    items: [],
  });
  const {
    isLoading: isSaving,
    error: saveError,
    run: runSave,
    reset: resetSave,
  } = useAsyncAction();

  // ── Detail ────────────────────────────────────────────────────────────
  const [selectedReturn, setSelectedReturn] = useState<SupplierReturnResult | null>(null);
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
    isLoading: approveLoading,
    error: approveError,
    run: runApprove,
    reset: resetApprove,
  } = useAsyncAction();
  const {
    isLoading: annulLoading,
    error: annulError,
    run: runAnnul,
    reset: resetAnnul,
  } = useAsyncAction();

  // ── Data loading ──────────────────────────────────────────────────────

  const loadReturns = useCallback(async () => {
    const result = await runListLoad(async () => {
      return await returnsService.listReturns({ page, pageSize: PAGE_SIZE });
    });
    if (result.success) {
      setReturns(result.data.data);
      setTotalReturns(result.data.total);
    }
  }, [returnsService, page, runListLoad, setTotalReturns]);

  useEffect(() => {
    loadReturns();
  }, [loadReturns]);

  // ── Supplier / Reception / Product search ─────────────────────────
  const [supplierResults, setSupplierResults] = useState<SearchableSelectOption[]>([]);
  const [receptionResults, setReceptionResults] = useState<SearchableSelectOption[]>([]);
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

  const handleReceptionSearch = useCallback(async (_query: string) => {
    try {
      const result = await receptionsService.listReceptions({ page: 1, pageSize: 10 });
      setReceptionResults(
        result.data.map((r) => ({
          id: r.id,
          label: r.id.slice(0, 8),
          sublabel: r.supplier.businessName,
        })),
      );
    } catch {
      setReceptionResults([]);
    }
  }, [receptionsService]);

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
      setSelectedReturnId(null);
      setSelectedReturn(null);
      resetDetail();
      resetConfirm();
      resetApprove();
      resetAnnul();
    } else {
      dispatch(navigateToPurchasesMain());
    }
  }, [viewMode, dispatch, resetDetail, resetConfirm, resetApprove, resetAnnul]);

  const handleViewReturn = useCallback(async (id: string) => {
    setSelectedReturnId(id);
    const result = await runDetailLoad(async () => {
      return await returnsService.getReturn(id);
    });
    if (result.success) {
      setSelectedReturn(result.data);
      setViewMode('detail');
    }
  }, [returnsService, runDetailLoad]);

  // ── Create form ───────────────────────────────────────────────────────

  const handleCreateClick = useCallback(() => {
    setFormData({
      supplierId: '',
      purchaseReceptionId: undefined,
      reason: '',
      items: [],
    });
    resetSave();
    setViewMode('create');
  }, [resetSave]);

  const handleFormChange = useCallback((partial: Partial<CreateSupplierReturnInput>) => {
    setFormData((prev: CreateSupplierReturnInput) => ({ ...prev, ...partial }));
  }, []);

  const handleCreateSubmit = useCallback(async () => {
    const result = await runSave(async () => {
      return await returnsService.createReturn(formData);
    });
    if (result.success) {
      setSelectedReturn(result.data);
      setViewMode('detail');
      await loadReturns();
    }
  }, [formData, returnsService, loadReturns, runSave]);

  // ── Actions ───────────────────────────────────────────────────────────

  const handleConfirmReturn = useCallback(async () => {
    if (!selectedReturnId) return;
    const result = await runConfirm(async () => {
      return await returnsService.confirmReturn(selectedReturnId);
    });
    if (result.success) {
      setSelectedReturn(result.data);
      await loadReturns();
    }
  }, [selectedReturnId, returnsService, loadReturns, runConfirm]);

  const handleApproveReturn = useCallback(async () => {
    if (!selectedReturnId) return;
    const result = await runApprove(async () => {
      return await returnsService.approveReturn(selectedReturnId);
    });
    if (result.success) {
      setSelectedReturn(result.data);
      await loadReturns();
    }
  }, [selectedReturnId, returnsService, loadReturns, runApprove]);

  const handleAnnulReturn = useCallback(async () => {
    if (!selectedReturnId) return;
    const result = await runAnnul(async () => {
      return await returnsService.annulReturn(selectedReturnId);
    });
    if (result.success) {
      setSelectedReturn(result.data);
      await loadReturns();
    }
  }, [selectedReturnId, returnsService, loadReturns, runAnnul]);

  // ── Permissions ───────────────────────────────────────────────────────

  const session = useLocalSessionStore((s) => s.session);
  const canEdit = useMemo(() => {
    if (!session) return false;
    return ['INVENTORY_ASSISTANT', 'ADMIN', 'ACCOUNTANT', 'MANAGER', 'OWNER', 'SAAS_ADMIN'].includes(session.role);
  }, [session]);

  const isDraft = selectedReturn?.state === 'DRAFT';
  const isConfirmed = selectedReturn?.state === 'CONFIRMED';
  const canConfirm = canEdit && isDraft;
  const canApprove = canEdit && isConfirmed;
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
              ? t('purchases.supplierReturns.createTitle')
              : viewMode === 'detail'
                ? t('purchases.supplierReturns.detailTitle')
                : t('purchases.supplierReturns.title')}
          </h1>
        </div>
        {viewMode === 'list' && canEdit && (
          <button
            onClick={handleCreateClick}
            className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            + {t('purchases.supplierReturns.create')}
          </button>
        )}
        {viewMode === 'detail' && canConfirm && (
          <button
            onClick={handleConfirmReturn}
            disabled={confirmLoading}
            className="px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-sm disabled:opacity-50"
          >
            {confirmLoading ? t('common.processing') : t('purchases.supplierReturns.confirm')}
          </button>
        )}
        {viewMode === 'detail' && canApprove && (
          <button
            onClick={handleApproveReturn}
            disabled={approveLoading}
            className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50"
          >
            {approveLoading ? t('common.processing') : t('purchases.supplierReturns.approve')}
          </button>
        )}
        {viewMode === 'detail' && canAnnul && (
          <button
            onClick={handleAnnulReturn}
            disabled={annulLoading}
            className="px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 text-sm disabled:opacity-50"
          >
            {annulLoading ? t('common.processing') : t('purchases.supplierReturns.annul')}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {viewMode === 'list' && (
          <SupplierReturnList
            returns={returns}
            isLoading={isLoadingList}
            error={listError}
            total={totalReturns}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            onView={handleViewReturn}
          />
        )}

        {viewMode === 'create' && (
          <SupplierReturnForm
            data={formData}
            onChange={handleFormChange}
            onSubmit={handleCreateSubmit}
            onCancel={() => setViewMode('list')}
            isSaving={isSaving}
            error={saveError}
            suppliers={supplierResults}
            onSupplierSearch={handleSupplierSearch}
            receptions={receptionResults}
            onReceptionSearch={handleReceptionSearch}
            isSearchingReception={false}
            productResults={productResults}
            onProductSearch={handleProductSearch}
            isSearchingProduct={isSearchingProduct}
          />
        )}

        {viewMode === 'detail' && (
          <SupplierReturnDetail
            returnData={selectedReturn}
            isLoading={detailLoading}
            error={detailError || confirmError || approveError || annulError}
            onBack={() => setViewMode('list')}
          />
        )}
      </div>
    </div>
  );
};
