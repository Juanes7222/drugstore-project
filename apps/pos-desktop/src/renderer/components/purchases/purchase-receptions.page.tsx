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
import { ArrowLeftIcon } from "@/components/ui/icons";
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/store/hooks';
import { navigateToPurchasesMain } from '@/store/slices/ui-slice';
import { useLocalSessionStore } from '../../../domain/auth/local-session.store';
import { getPurchasesConfig } from '../../../domain/configuration';
import {
  usePurchaseReceptionsService,
  useSuppliersService,
  useProductService,
  usePurchaseOrdersService,
} from '../common/service-context';
import { useAsyncAction } from '../../hooks/use-async-action';
import { usePagination } from '../../hooks/use-pagination';
import { PURCHASE_RECEPTIONS_EXPORT } from '../../../domain/export';
import { useDataExport } from '../../hooks/use-data-export';
import { ExportMenu } from '../ui/export-menu';
import { notify } from '@/utils/notify';
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

  // Export (full reception dataset — the screen has no filters today)
  const {
    exportTo: exportReceptions,
    isExporting: isExportingReceptions,
    error: exportError,
  } = useDataExport(PURCHASE_RECEPTIONS_EXPORT, {});

  useEffect(() => {
    if (!exportError) return;
    notify.error({
      title: t('export.error', { defaultValue: 'No se pudo generar la exportación' }),
      description: exportError,
    });
  }, [exportError, t]);

  // ── Create form ───────────────────────────────────────────────────────
  const [formData, setFormData] = useState<CreateReceptionInput>({
    supplierId: '',
    purchaseOrderId: undefined,
    notes: '',
    items: [],
  });
  const [validationError, setValidationError] = useState<string | null>(null);
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
          sublabel: `${p.laboratory}${p.currentCost ? ` · Costo: $${p.currentCost}` : ''}`,
          currentCost: p.currentCost,
        } as SearchableSelectOption & { currentCost: string | null })),
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
    const cfg = getPurchasesConfig();
    setValidationError(null);

    if (cfg.requireLotOnReception) {
      const missingLot = formData.items.find(
        (item: any) => item.receivedQuantity > 0 && !(item.lotNumber ?? '').toString().trim(),
      );
      if (missingLot) {
        setValidationError(t('purchases.receptions.validationLotRequired'));
        return;
      }
    }

    if (cfg.requireExpiryOnReception) {
      const missingExpiry = formData.items.find(
        (item: any) => item.receivedQuantity > 0 && !(item.expirationDate ?? '').toString().trim(),
      );
      if (missingExpiry) {
        setValidationError(t('purchases.receptions.validationExpiryRequired'));
        return;
      }
    }

    const result = await runSave(async () => {
      const created = await receptionsService.createReception(formData);
      return created;
    });
    if (result.success) {
      setValidationError(null);
      setSelectedReception(result.data);
      setViewMode('detail');
      await loadReceptions();
    }
  }, [formData, receptionsService, loadReceptions, runSave, t]);

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
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="text-ink-muted hover:text-ink transition-colors"
            aria-label={t('common.back')}
          >
            <ArrowLeftIcon size={20} aria-hidden="true" />
          </button>
          <h1 className="pos-page-title">
            {viewMode === 'create'
              ? t('purchases.receptions.createTitle')
              : viewMode === 'detail'
                ? t('purchases.receptions.detailTitle')
                : t('purchases.receptions.title')}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'list' && !isLoadingList && receptions.length > 0 && (
            <ExportMenu
              onExport={exportReceptions}
              exporting={isExportingReceptions}
              className="shrink-0"
            />
          )}
          {viewMode === 'list' && canEdit && (
          <button
            onClick={handleCreateClick}
            className="px-3 py-1.5 pos-button pos-button-primary text-sm"
          >
            + {t('purchases.receptions.create')}
          </button>
        )}
        {viewMode === 'detail' && canConfirm && (
          <button
            onClick={handleConfirmReception}
            disabled={confirmLoading}
            className="px-3 py-1.5 pos-button pos-button-primary text-sm disabled:opacity-50"
          >
            {confirmLoading ? t('common.processing') : t('purchases.receptions.confirm')}
          </button>
        )}
        {viewMode === 'detail' && canAnnul && (
          <button
            onClick={handleAnnulReception}
            disabled={annulLoading}
            className="px-3 py-1.5 pos-button pos-button-restrict text-sm disabled:opacity-50"
          >
            {annulLoading ? t('common.processing') : t('purchases.receptions.annul')}
          </button>
        )}
        </div>
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
            error={validationError || saveError}
            requireLotOnReception={getPurchasesConfig().requireLotOnReception}
            requireExpiryOnReception={getPurchasesConfig().requireExpiryOnReception}
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
