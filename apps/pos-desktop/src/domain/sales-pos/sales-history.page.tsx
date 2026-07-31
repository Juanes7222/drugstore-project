/**
 * Sales history page — thin wiring container.
 *
 * Lists confirmed sales and shows each sale alongside its immutable DIAN fiscal
 * invoice and its editable operational (pharmacy) view. The presentational
 * components live under `src/renderer/components/sales-history/`.
 *
 * Role-gated to MANAGER, OWNER, or SAAS_ADMIN.
 */

import { type FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalSessionStore } from '../auth/local-session.store';
import { useLocalAdjustmentService, useSalesHistoryService, useInvoiceService } from '../../renderer/components/common/service-context';
import { RoleType } from '@pharmacy/shared-types';
import type { AdjustmentType, OperationalInvoiceView, AdjustmentHistoryEntry } from '../fiscal/local-adjustment.types';
import type { SaleHistoryListItem, SaleHistoryDetail, SaleHistoryFilters } from './sales-history.service';

// Presentational components (owned by frontend-pos)
import { SalesHistoryList } from '../../renderer/components/sales-history/sales-history-list';
import { SalesHistoryDetail } from '../../renderer/components/sales-history/sales-history-detail';
import { SalesHistoryAdjustmentModal } from '../../renderer/components/sales-history/sales-history-adjustment-modal';

const PAGE_SIZE = 50;

export const SalesHistoryPage: FC = () => {
  const { t } = useTranslation('salesHistory');
  const session = useLocalSessionStore((s) => s.session);
  const salesHistoryService = useSalesHistoryService();
  const localAdjustmentService = useLocalAdjustmentService();
  const invoiceService = useInvoiceService();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sales, setSales] = useState<SaleHistoryListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filters, setFilters] = useState<SaleHistoryFilters>({ limit: PAGE_SIZE, offset: 0 });

  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SaleHistoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailView, setDetailView] = useState<'fiscal' | 'operational'>('operational');

  const [operationalView, setOperationalView] = useState<OperationalInvoiceView | null>(null);
  const [adjustmentHistory, setAdjustmentHistory] = useState<AdjustmentHistoryEntry[]>([]);
  const [adjustmentHistoryLoading, setAdjustmentHistoryLoading] = useState(false);

  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [adjustmentModalLoading, setAdjustmentModalLoading] = useState(false);
  const [adjustmentModalError, setAdjustmentModalError] = useState<string | null>(null);
  const [allowedAdjustmentTypes, setAllowedAdjustmentTypes] = useState<AdjustmentType[]>([]);

  const role = session?.role as RoleType | undefined;
  const isAllowed =
    role === RoleType.MANAGER ||
    role === RoleType.OWNER ||
    role === RoleType.SAAS_ADMIN;

  const loadSales = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await salesHistoryService.listConfirmedSales(filters);
      setSales(result.items);
      setTotalCount(result.total);
    } catch (err) {
      console.error('[SalesHistoryPage] loadSales failed:', err);
      setError(err instanceof Error ? err.message : t('error_load'));
    } finally {
      setLoading(false);
    }
  }, [salesHistoryService, filters, t]);

  useEffect(() => {
    void loadSales();
  }, [loadSales]);

  const loadDetail = useCallback(
    async (saleId: string) => {
      setDetailLoading(true);
      setSelectedSaleId(saleId);
      try {
        const detail = await salesHistoryService.getSaleHistoryDetail(saleId);
        setSelectedDetail(detail);
        if (detail?.mainInvoiceOperationalView) {
          setOperationalView(detail.mainInvoiceOperationalView);
          setAdjustmentHistory(detail.adjustmentHistory);
        } else {
          setOperationalView(null);
          setAdjustmentHistory([]);
        }
      } catch (err) {
        console.error('[SalesHistoryPage] loadDetail failed:', err);
        setError(err instanceof Error ? err.message : t('error_detail'));
        setSelectedDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [salesHistoryService, t],
  );

  const handleSelectSale = useCallback(
    (saleId: string) => {
      setDetailView('operational');
      void loadDetail(saleId);
    },
    [loadDetail],
  );

  const handleCloseDetail = useCallback(() => {
    setSelectedSaleId(null);
    setSelectedDetail(null);
    setOperationalView(null);
    setAdjustmentHistory([]);
  }, []);

  const handleFiltersChange = useCallback((next: Partial<SaleHistoryFilters>) => {
    setFilters((prev) => ({ ...prev, ...next, offset: 0 }));
  }, []);

  const handleLoadMore = useCallback(() => {
    setFilters((prev) => ({ ...prev, offset: (prev.offset ?? 0) + PAGE_SIZE }));
  }, []);

  const handleReprint = useCallback(async () => {
    const mainInvoice = selectedDetail?.invoices[0];
    if (!mainInvoice) return;
    try {
      const { generateReceiptHtml, printReceipt } = await import('../fiscal/receipt-generator');
      const html = generateReceiptHtml(mainInvoice);
      printReceipt(html);
    } catch (err) {
      console.error('[SalesHistoryPage] handleReprint failed:', err);
    }
  }, [selectedDetail]);

  const handleCancelInvoice = useCallback(async () => {
    const mainInvoice = selectedDetail?.invoices[0];
    if (!mainInvoice || !invoiceService) return;
    try {
      await invoiceService.cancelInvoice(
        mainInvoice.id,
        t('cancel_reason', { defaultValue: 'Manual cancellation by manager' }),
      );
      await loadDetail(mainInvoice.saleId);
      await loadSales();
    } catch (err) {
      console.error('[SalesHistoryPage] handleCancelInvoice failed:', err);
    }
  }, [selectedDetail, invoiceService, t, loadDetail, loadSales]);

  const handleOpenAdjustmentModal = useCallback(async () => {
    const mainInvoice = selectedDetail?.invoices[0];
    if (!mainInvoice || !localAdjustmentService) return;
    setAdjustmentModalError(null);
    try {
      const types = await localAdjustmentService.getAllowableAdjustmentTypes(mainInvoice.id);
      setAllowedAdjustmentTypes(types);
      setShowAdjustmentModal(true);
    } catch (err) {
      console.error('[SalesHistoryPage] handleOpenAdjustmentModal failed:', err);
      setAdjustmentModalError(
        err instanceof Error ? err.message : t('adjustment.error_load_types'),
      );
      setShowAdjustmentModal(true);
    }
  }, [selectedDetail, localAdjustmentService, t]);

  const handleCloseAdjustmentModal = useCallback(() => {
    setShowAdjustmentModal(false);
    setAdjustmentModalError(null);
    setAdjustmentModalLoading(false);
    setAllowedAdjustmentTypes([]);
  }, []);

  const handleApplyAdjustment = useCallback(
    async (type: AdjustmentType, newValue: unknown, reason: string) => {
      const mainInvoice = selectedDetail?.invoices[0];
      if (!mainInvoice || !localAdjustmentService) return;

      setAdjustmentModalLoading(true);
      setAdjustmentModalError(null);
      try {
        await localAdjustmentService.applyAdjustment(mainInvoice.id, type, newValue, reason);
        setAdjustmentHistoryLoading(true);
        const [opView, adjHist] = await Promise.all([
          localAdjustmentService.resolveOperationalView(mainInvoice.id),
          localAdjustmentService.getAdjustmentHistory(mainInvoice.id),
        ]);
        setOperationalView(opView);
        setAdjustmentHistory(adjHist);
        setShowAdjustmentModal(false);
        await loadSales();
      } catch (err) {
        console.error('[SalesHistoryPage] handleApplyAdjustment failed:', err);
        setAdjustmentModalError(
          err instanceof Error ? err.message : t('adjustment.error_apply'),
        );
      } finally {
        setAdjustmentModalLoading(false);
        setAdjustmentHistoryLoading(false);
      }
    },
    [selectedDetail, localAdjustmentService, loadSales, t],
  );

  if (!isAllowed) {
    return (
      <section className="flex h-full items-center justify-center p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <h2 className="text-lg font-bold text-red-700">{t('access_denied_title')}</h2>
          <p className="mt-2 text-red-600">{t('access_denied_message')}</p>
        </div>
      </section>
    );
  }

  if (loading && sales.length === 0) {
    return (
      <section className="flex h-full items-center justify-center p-6">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-t-blue-500 border-r-blue-500 border-transparent" />
          <p className="text-gray-500">{t('loading')}</p>
        </div>
      </section>
    );
  }

  if (error && sales.length === 0) {
    return (
      <section className="flex h-full items-center justify-center p-6">
        <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-center">
          <h2 className="text-lg font-bold text-red-700">{t('error_title')}</h2>
          <p className="mt-2 text-red-600">{error}</p>
          <button
            type="button"
            className="mt-4 rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
            onClick={loadSales}
          >
            {t('retry')}
          </button>
        </div>
      </section>
    );
  }

  const mainInvoice = selectedDetail?.invoices[0];

  return (
    <section className="flex h-full flex-col overflow-hidden bg-gray-50">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {/* List */}
        <div className={`min-h-0 flex-1 overflow-y-auto p-6 ${selectedSaleId ? 'lg:pr-3' : ''}`}>
          <SalesHistoryList
            sales={sales}
            totalCount={totalCount}
            loading={loading}
            filters={filters}
            onSelect={handleSelectSale}
            onRefresh={loadSales}
            onFiltersChange={handleFiltersChange}
            onLoadMore={handleLoadMore}
          />
        </div>

        {/* Detail */}
        {selectedSaleId && (
          <aside className={`flex h-1/2 min-h-0 w-full shrink-0 flex-col overflow-hidden border-t border-gray-200 bg-white lg:h-auto lg:border-l lg:border-t-0 ${
            detailView === 'fiscal' ? 'lg:w-[24rem]' : 'lg:w-[28rem]'
          }`}>
            <SalesHistoryDetail
              saleId={selectedSaleId}
              detail={selectedDetail}
              loading={detailLoading}
              viewMode={detailView}
              operationalView={operationalView}
              adjustmentHistory={adjustmentHistory}
              adjustmentHistoryLoading={adjustmentHistoryLoading}
              onViewModeChange={setDetailView}
              onClose={handleCloseDetail}
              onCreateAdjustment={handleOpenAdjustmentModal}
              onReprint={handleReprint}
              onCancelInvoice={handleCancelInvoice}
            />
          </aside>
        )}
      </div>

      {/* Adjustment modal */}
      {mainInvoice && (
        <SalesHistoryAdjustmentModal
          visible={showAdjustmentModal}
          saleId={selectedDetail?.sale.id ?? ''}
          invoiceId={mainInvoice.id}
          invoiceStatus={mainInvoice.status}
          operationalView={operationalView}
          allowedTypes={allowedAdjustmentTypes}
          loading={adjustmentModalLoading}
          error={adjustmentModalError}
          onSubmit={handleApplyAdjustment}
          onClose={handleCloseAdjustmentModal}
        />
      )}
    </section>
  );
};

export default SalesHistoryPage;
