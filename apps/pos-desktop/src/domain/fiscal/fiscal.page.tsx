/**
 * Manager/Admin fiscal management page.
 *
 * Role-gated to ADMIN. Shows:
 * - Invoice list with filtering
 * - Dual-panel invoice detail (fiscal + operational)
 * - Adjustment history and management
 * - Contingency event history
 *
 * This is a thin wiring container. Presentational components are in
 * src/renderer/components/fiscal/ (owned by the frontend-pos agent).
 *
 * @category Page
 */

import { type FC, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RoleType } from '@pharmacy/shared-types';
import { getLocalDatabase } from '../../infrastructure/local-database';
import type { PrismaClient } from '@pharmacy/database/local';
import { createInvoiceService, type InvoiceService } from './invoice.service';
import { createContingencyService, type ContingencyService } from './contingency.service';
import { createFiscalNumberingService, type FiscalNumberingService } from './numbering.service';
import { useContingencyStore } from './contingency.store';
import { createFiscalScheduler, type FiscalScheduler } from './fiscal-scheduler.service';
import type { InvoiceListItem, InvoiceModel, ContingencyEventSummary } from './fiscal-types';
import { useLocalSessionStore } from '../auth/local-session.store';
import type { AuthService } from '../auth/auth.service';
import {
  createLocalAdjustmentService,
  type LocalAdjustmentService,
} from './local-adjustment.service';
import type { OperationalInvoiceView, AdjustmentHistoryEntry } from './local-adjustment.types';

// Presentational components
import { InvoiceListView } from '../../renderer/components/fiscal/invoice-list-view';
import { ContingencyHistoryView } from '../../renderer/components/fiscal/contingency-history-view';
import { FiscalInvoiceDetailPanel } from '../../renderer/components/fiscal/fiscal-invoice-detail-panel';
import { OperationalInvoiceDetailPanel } from '../../renderer/components/fiscal/operational-invoice-detail-panel';
import { AdjustmentHistoryPanel } from '../../renderer/components/fiscal/adjustment-history-panel';

const AUTO_REFRESH_MS = 30_000;

export const FiscalPage: FC = () => {
  const { t } = useTranslation('fiscal');
  const session = useLocalSessionStore((s) => s.session);
  const contingencyState = useContingencyStore.getState();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceModel | null>(null);
  const [history, setHistory] = useState<ContingencyEventSummary[]>([]);
  const [tab, setTab] = useState<'invoices' | 'contingency'>('invoices');

  // Operational view state
  const [operationalView, setOperationalView] = useState<OperationalInvoiceView | null>(null);
  const [adjustmentHistory, setAdjustmentHistory] = useState<AdjustmentHistoryEntry[]>([]);
  const [operationalLoading, setOperationalLoading] = useState(false);

  // Detail panel sub-tab: 'fiscal' shows only fiscal panel, 'dual' shows both
  const [detailView, setDetailView] = useState<'fiscal' | 'dual'>('fiscal');

  const servicesRef = useRef<{
    invoiceService: InvoiceService | null;
    contingencyService: ContingencyService | null;
    numberingService: FiscalNumberingService | null;
    fiscalScheduler: FiscalScheduler | null;
    authService: AuthService | null;
    adjustmentService: LocalAdjustmentService | null;
  }>({
    invoiceService: null,
    contingencyService: null,
    numberingService: null,
    fiscalScheduler: null,
    authService: null,
    adjustmentService: null,
  });

  const createServices = useCallback(async () => {
    const { prisma } = await getLocalDatabase();
    const prismaClient = prisma as PrismaClient;
    const wsId = session?.workstationId ?? 'unknown';

    const numberingService = createFiscalNumberingService({ prisma: prismaClient, workstationId: wsId });
    const contingencyService = createContingencyService({ prisma: prismaClient, workstationId: wsId });
    const invoiceService = createInvoiceService({
      prisma: prismaClient,
      workstationId: wsId,
      numberingService,
      contingencyService,
    });
    const fiscalScheduler = createFiscalScheduler({ invoiceService, contingencyService });
    // Auth service wrapper using the local session store (no server dependency needed
    // for the read-only requireRole calls that LocalAdjustmentService uses).
    const authService: AuthService = {
      requireRole: (...allowedRoles) => {
        const s = useLocalSessionStore.getState().session;
        if (!s) throw new Error('No active session');
        const sessionRole = s.role as RoleType;
        if (!allowedRoles.includes(sessionRole)) {
          throw new Error(`Requires role ${allowedRoles.join(' or ')}`);
        }
        return s;
      },
      getCurrentSession: () => useLocalSessionStore.getState().session,
      login: async () => { throw new Error('login() not available from fiscal page'); },
      logout: () => useLocalSessionStore.getState().clearSession(),
    };
    const adjustmentService = createLocalAdjustmentService(prismaClient, authService);

    servicesRef.current = {
      invoiceService,
      contingencyService,
      numberingService,
      fiscalScheduler,
      authService,
      adjustmentService,
    };

    return { invoiceService, contingencyService };
  }, [session?.workstationId]);

  const loadData = useCallback(async () => {
    try {
      const { invoiceService, contingencyService } = await createServices();

      const [invResult, histResult] = await Promise.all([
        invoiceService.listInvoices({ limit: 50 }),
        contingencyService.listHistory(20),
      ]);

      setInvoices(invResult.items);
      setTotalCount(invResult.total);
      setHistory(histResult);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error_load'));
      setLoading(false);
    }
  }, [createServices, t]);

  useEffect(() => { void loadData(); }, [loadData]);

  // Auto-refresh invoices
  useEffect(() => {
    const interval = setInterval(async () => {
      const svc = servicesRef.current.invoiceService;
      if (!svc) return;
      try {
        const invResult = await svc.listInvoices({ limit: 50 });
        setInvoices(invResult.items);
        setTotalCount(invResult.total);
      } catch { /* advisory */ }
    }, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  // Load operational view and adjustment history when invoice selected
  const handleSelectInvoice = useCallback(async (invoice: InvoiceModel) => {
    setSelectedInvoice(invoice);
    setDetailView('fiscal');

    const adjSvc = servicesRef.current.adjustmentService;
    if (!adjSvc) return;

    setOperationalLoading(true);
    try {
      const [opView, adjHist] = await Promise.all([
        adjSvc.resolveOperationalView(invoice.id),
        adjSvc.getAdjustmentHistory(invoice.id),
      ]);
      setOperationalView(opView);
      setAdjustmentHistory(adjHist);
    } catch {
      setOperationalView(null);
      setAdjustmentHistory([]);
    } finally {
      setOperationalLoading(false);
    }
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedInvoice(null);
    setOperationalView(null);
    setAdjustmentHistory([]);
  }, []);

  const handleReprint = useCallback(async () => {
    if (!selectedInvoice) return;
    try {
      const { generateReceiptHtml, printReceipt } = await import('./receipt-generator');
      const html = generateReceiptHtml(selectedInvoice);
      printReceipt(html);
    } catch (err) {
      // Error handled silently — the detail panel shows no action message here
      // since the wiring page doesn't manage one; the component handles it internally.
    }
  }, [selectedInvoice]);

  const handleCancel = useCallback(async () => {
    if (!selectedInvoice || !servicesRef.current.invoiceService) return;
    try {
      await servicesRef.current.invoiceService.cancelInvoice(
        selectedInvoice.id,
        t('cancel_reason', { defaultValue: 'Manual cancellation by manager' }),
      );
      setSelectedInvoice(null);
      await loadData();
    } catch (err) {
      // similarly silent; the panel will display error via actionMessage prop
    }
  }, [selectedInvoice, loadData, t]);

  const handleExportCsv = useCallback(async () => {
    const adjSvc = servicesRef.current.adjustmentService;
    if (!adjSvc || !selectedInvoice) return;
    try {
      const csv = await adjSvc.exportAdjustmentLogAsCsv(selectedInvoice.id);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ajustes-${selectedInvoice.invoiceNumber}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // swallow
    }
  }, [selectedInvoice]);

  // Role check
  const role = session?.role as RoleType | undefined;
  const isAdmin = role === RoleType.ADMIN;
  if (!isAdmin) {
    return (
      <section className="flex h-full items-center justify-center p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <h2 className="text-lg font-bold text-red-700">{t('access_denied_title')}</h2>
          <p className="mt-2 text-red-600">{t('access_denied_message')}</p>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="flex h-full items-center justify-center p-6">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-t-blue-500 border-r-blue-500 border-transparent" />
          <p className="text-gray-500">{t('loading')}</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="flex h-full items-center justify-center p-6">
        <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-center">
          <h2 className="text-lg font-bold text-red-700">{t('error_title')}</h2>
          <p className="mt-2 text-red-600">{error}</p>
          <button
            className="mt-4 rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
            onClick={loadData}
          >
            {t('retry')}
          </button>
        </div>
      </section>
    );
  }

  const isPending = selectedInvoice?.status === 'CONTINGENCY_PENDING_TRANSMISSION';
  const isCancellable = !!(
    selectedInvoice &&
    (isPending || selectedInvoice.status === 'TRANSMITTED_AUTHORIZED')
  );

  return (
    <section className="flex h-full flex-col overflow-hidden bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800">{t('title')}</h1>
          <div className="flex items-center gap-4">
            {contingencyState.active && (
              <span className="inline-flex items-center gap-2 rounded bg-red-600 px-3 py-1 text-sm font-bold text-white">
                <span className="h-2 w-2 rounded-full bg-white" />
                {t('contingency_mode')}
              </span>
            )}
          </div>
        </div>

        {/* Tab navigation */}
        <div className="mt-4 flex gap-4 border-b border-gray-200">
          <button
            className={`pb-2 text-sm font-medium ${
              tab === 'invoices'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setTab('invoices')}
          >
            {t('tab_invoices', { count: totalCount })}
          </button>
          <button
            className={`pb-2 text-sm font-medium ${
              tab === 'contingency'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setTab('contingency')}
          >
            {t('tab_contingency')}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main content area */}
        <div className={`flex-1 overflow-y-auto p-6 ${selectedInvoice ? 'pr-3' : ''}`}>
          {tab === 'invoices' && (
            <InvoiceListView
              invoices={invoices}
              onSelect={handleSelectInvoice}
              onRefresh={loadData}
            />
          )}

          {tab === 'contingency' && (
            <ContingencyHistoryView history={history} />
          )}
        </div>

        {/* Invoice detail side panel */}
        {selectedInvoice && (
          <aside
            className="flex flex-col border-l border-gray-200 bg-white overflow-hidden"
            style={{ width: detailView === 'dual' ? '48rem' : '24rem' }}
          >
            {/* Detail view toggle */}
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
              <h2 className="text-sm font-semibold text-gray-700">{t('invoice_detail')}</h2>
              <div className="flex items-center gap-2">
                <button
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    detailView === 'fiscal'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                  onClick={() => setDetailView('fiscal')}
                >
                  {t('view_fiscal')}
                </button>
                {operationalView && (
                  <button
                    className={`rounded px-2 py-1 text-xs font-medium ${
                      detailView === 'dual'
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-500 hover:bg-gray-100'
                    }`}
                    onClick={() => setDetailView('dual')}
                  >
                    {t('view_dual')}
                  </button>
                )}
                <button
                  className="text-gray-400 hover:text-gray-600"
                  onClick={handleCloseDetail}
                  aria-label={t('close')}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* Fiscal panel (always visible) */}
              <div className={`overflow-y-auto ${detailView === 'dual' ? 'w-1/2 border-r border-gray-200' : 'flex-1'}`}>
                <FiscalInvoiceDetailPanel
                  invoice={selectedInvoice}
                  onReprint={handleReprint}
                  onCancel={handleCancel}
                  isCancelling={false}
                  isCancellable={isCancellable}
                />
              </div>

              {/* Operational panel (visible in dual mode) */}
              {detailView === 'dual' && operationalView && (
                <div className="flex w-1/2 flex-col overflow-y-auto">
                  <OperationalInvoiceDetailPanel
                    operationalView={operationalView}
                    adjustmentCount={adjustmentHistory.length}
                    isLoading={operationalLoading}
                  />

                  {/* Adjustment history within the dual panel */}
                  {adjustmentHistory.length > 0 && (
                    <div className="border-t border-gray-200">
                      <AdjustmentHistoryPanel
                        adjustments={adjustmentHistory}
                        isLoading={operationalLoading}
                        onExportCsv={handleExportCsv}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
};
