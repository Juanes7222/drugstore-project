/**
 * Manager/Admin fiscal management page.
 *
 * Role-gated to ADMIN and MANAGER. Shows:
 * - Active contingency panel (visible only when in contingency)
 * - Invoice list with filtering and export
 * - Invoice detail view with reprint and cancel actions
 * - Contingency event history
 *
 * This is a thin wiring container. Presentational components are in
 * src/renderer/components/fiscal/ (owned by the frontend-pos agent).
 *
 * @category Page
 */

import { type FC, useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSessionStore } from '../auth/local-session.store';
import { RoleType } from '@pharmacy/shared-types';
import { getLocalDatabase } from '../../infrastructure/local-database';
import type { PrismaClient } from '@pharmacy/database/local';
import { createInvoiceService, type InvoiceService } from './invoice.service';
import { createContingencyService, type ContingencyService } from './contingency.service';
import { createFiscalNumberingService, type FiscalNumberingService } from './numbering.service';
import { useContingencyStore } from './contingency.store';
import { createFiscalScheduler, type FiscalScheduler } from './fiscal-scheduler.service';
import type { InvoiceListItem, InvoiceModel, ContingencyEventSummary } from './fiscal-types';

const AUTO_REFRESH_MS = 30_000;

export const FiscalPage: FC = () => {
  const session = useLocalSessionStore((s) => s.session);
  const contingencyState = useContingencyStore.getState();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceModel | null>(null);
  const [history, setHistory] = useState<ContingencyEventSummary[]>([]);
  const [tab, setTab] = useState<'invoices' | 'contingency'>('invoices');

  const servicesRef = useRef<{
    invoiceService: InvoiceService | null;
    contingencyService: ContingencyService | null;
    numberingService: FiscalNumberingService | null;
    fiscalScheduler: FiscalScheduler | null;
  }>({
    invoiceService: null,
    contingencyService: null,
    numberingService: null,
    fiscalScheduler: null,
  });

  const loadData = useCallback(async () => {
    try {
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

      servicesRef.current = {
        invoiceService,
        contingencyService,
        numberingService,
        fiscalScheduler,
      };

      const [invResult, histResult] = await Promise.all([
        invoiceService.listInvoices({ limit: 50 }),
        contingencyService.listHistory(20),
      ]);

      setInvoices(invResult.items);
      setTotalCount(invResult.total);
      setHistory(histResult);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fiscal data');
      setLoading(false);
    }
  }, [session?.workstationId]);

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

  // Role check
  const role = session?.role as RoleType | undefined;
  const isManager = role === RoleType.ADMIN;
  if (!isManager) {
    return (
      <section className="flex h-full items-center justify-center p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <h2 className="text-lg font-bold text-red-700">Acceso denegado</h2>
          <p className="mt-2 text-red-600">
            Solo administradores pueden acceder a la gesti&oacute;n fiscal.
          </p>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="flex h-full items-center justify-center p-6">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-t-blue-500 border-r-blue-500 border-transparent" />
          <p className="text-gray-500">Cargando datos fiscales…</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="flex h-full items-center justify-center p-6">
        <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-center">
          <h2 className="text-lg font-bold text-red-700">Error</h2>
          <p className="mt-2 text-red-600">{error}</p>
          <button
            className="mt-4 rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
            onClick={loadData}
          >
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full flex-col overflow-hidden bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800">Gesti&oacute;n Fiscal / DIAN</h1>
          <div className="flex items-center gap-4">
            {contingencyState.active && (
              <span className="inline-flex items-center gap-2 rounded bg-red-600 px-3 py-1 text-sm font-bold text-white">
                <span className="h-2 w-2 rounded-full bg-white" />
                MODO CONTINGENCIA
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
            Facturas ({totalCount})
          </button>
          <button
            className={`pb-2 text-sm font-medium ${
              tab === 'contingency'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setTab('contingency')}
          >
            Historial de Contingencia
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'invoices' && (
          <InvoiceListView
            invoices={invoices}
            onSelect={setSelectedInvoice}
            onRefresh={loadData}
            invoiceService={servicesRef.current.invoiceService}
          />
        )}

        {tab === 'contingency' && (
          <ContingencyHistoryView history={history} />
        )}
      </div>

      {/* Invoice detail drawer */}
      {selectedInvoice && servicesRef.current.invoiceService && (
        <InvoiceDetailDrawer
          invoice={selectedInvoice}
          invoiceService={servicesRef.current.invoiceService}
          onClose={() => setSelectedInvoice(null)}
          onUpdated={loadData}
        />
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Invoice list view
// ---------------------------------------------------------------------------

interface InvoiceListViewProps {
  invoices: InvoiceListItem[];
  onSelect: (invoice: InvoiceModel) => void;
  onRefresh: () => Promise<void>;
  invoiceService: InvoiceService | null;
}

const InvoiceListView: FC<InvoiceListViewProps> = ({ invoices, onSelect, onRefresh, invoiceService }) => {
  const statusColor = (status: string): string => {
    switch (status) {
      case 'CONTINGENCY_PENDING_TRANSMISSION': return 'text-yellow-700 bg-yellow-100';
      case 'TRANSMITTED_AUTHORIZED': return 'text-green-700 bg-green-100';
      case 'TRANSMITTED_REJECTED': return 'text-red-700 bg-red-100';
      case 'EXPIRED_CONTINGENCY': return 'text-gray-700 bg-gray-200';
      case 'CANCELLED': return 'text-gray-500 bg-gray-100';
      default: return 'text-gray-700 bg-gray-100';
    }
  };

  const statusLabel = (status: string): string => {
    switch (status) {
      case 'CONTINGENCY_PENDING_TRANSMISSION': return 'Pendiente transmisión';
      case 'TRANSMITTED_AUTHORIZED': return 'Autorizado DIAN';
      case 'TRANSMITTED_REJECTED': return 'Rechazado DIAN';
      case 'EXPIRED_CONTINGENCY': return 'Vencido';
      case 'CANCELLED': return 'Anulado';
      default: return status;
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 uppercase">Facturas</h2>
          <button
            className="rounded bg-gray-100 px-3 py-1 text-xs text-gray-600 hover:bg-gray-200"
            onClick={onRefresh}
          >
            Refrescar
          </button>
        </div>
      </div>

      {invoices.length === 0 ? (
        <div className="px-4 py-12 text-center text-gray-400">
          No hay facturas registradas.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">No.</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Cliente</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Emisión</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Vence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => {
                    invoiceService?.findById(inv.id).then((full) => {
                      if (full) onSelect(full);
                    }).catch(() => {});
                  }}
                >
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-900">
                    {inv.contingencyNumber ?? inv.invoiceNumber}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                    {inv.invoiceType === 'CREDIT_NOTE' ? 'NC' : inv.invoiceType === 'CONTINGENCY_CANCELLATION' ? 'AN' : 'FE'}
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-gray-700">
                    {inv.clientName || 'Consumidor Final'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-gray-900">
                    ${Number(inv.totalAmount).toLocaleString('es-CO', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(inv.status)}`}>
                      {statusLabel(inv.status)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                    {new Date(inv.issuedAt).toLocaleDateString('es-CO')}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                    {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString('es-CO') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Contingency history view
// ---------------------------------------------------------------------------

interface ContingencyHistoryViewProps {
  history: ContingencyEventSummary[];
}

const ContingencyHistoryView: FC<ContingencyHistoryViewProps> = ({ history }) => {
  const triggerLabel = (trigger: string): string => {
    switch (trigger) {
      case 'NETWORK_LOST': return 'Red perdida';
      case 'MANUAL_OVERRIDE': return 'Anulación manual';
      case 'SERVER_UNREACHABLE': return 'Servidor inaccesible';
      default: return trigger;
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-700 uppercase">Eventos de Contingencia</h2>
      </div>

      {history.length === 0 ? (
        <div className="px-4 py-12 text-center text-gray-400">
          No hay eventos de contingencia registrados.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Inicio</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Fin</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Disparador</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Generadas</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Transmitidas</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Vencidas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.map((evt) => (
                <tr key={evt.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                    {new Date(evt.startedAt).toLocaleString('es-CO')}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                    {evt.endedAt ? new Date(evt.endedAt).toLocaleString('es-CO') : 'Activo'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                    {triggerLabel(evt.trigger)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-900 font-mono">
                    {evt.invoicesGenerated}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-900 font-mono">
                    {evt.invoicesTransmitted}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-900 font-mono">
                    {evt.invoicesExpired}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Invoice detail drawer
// ---------------------------------------------------------------------------

interface InvoiceDetailDrawerProps {
  invoice: InvoiceModel;
  invoiceService: InvoiceService;
  onClose: () => void;
  onUpdated: () => Promise<void>;
}

const InvoiceDetailDrawer: FC<InvoiceDetailDrawerProps> = ({ invoice, invoiceService, onClose, onUpdated }) => {
  const [cancelling, setCancelling] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const handleCancel = async () => {
    if (!confirm('¿Está seguro de anular esta factura? Esta acción no se puede deshacer.')) return;
    setCancelling(true);
    setActionMsg(null);
    try {
      await invoiceService.cancelInvoice(invoice.id, 'Anulación manual por gestor');
      setActionMsg('Factura anulada correctamente.');
      await onUpdated();
    } catch (err) {
      setActionMsg(`Error: ${err instanceof Error ? err.message : 'Error desconocido'}`);
    } finally {
      setCancelling(false);
    }
  };

  const handleReprint = async () => {
    try {
      const { generateReceiptHtml, printReceipt } = await import('./receipt-generator');
      const html = generateReceiptHtml(invoice);
      printReceipt(html);
    } catch (err) {
      setActionMsg(`Error al reimprimir: ${err instanceof Error ? err.message : 'Error'}`);
    }
  };

  const cufeDisplay = invoice.cufeOfficial ?? invoice.cufeProvisional;
  const isPending = invoice.status === 'CONTINGENCY_PENDING_TRANSMISSION';
  const isCancellable = isPending || invoice.status === 'TRANSMITTED_AUTHORIZED';

  return (
    <div className="w-96 border-l border-gray-200 bg-white overflow-y-auto">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-700">Detalle de Factura</h2>
        <button className="text-gray-400 hover:text-gray-600" onClick={onClose} aria-label="Cerrar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-4 space-y-3 text-sm">
        <DetailRow label="No. Factura" value={invoice.invoiceNumber} mono />
        <DetailRow label="Tipo" value={invoice.invoiceType} />
        <DetailRow label="Estado" value={invoice.status} badge />
        {invoice.contingencyNumber && (
          <DetailRow label="No. Contingencia" value={invoice.contingencyNumber} mono />
        )}

        <div className="border-t border-gray-100 pt-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">CUFE</h3>
          <div className="rounded bg-gray-50 p-2 text-xs font-mono break-all">
            {cufeDisplay}
          </div>
          {isPending && (
            <p className="mt-1 text-xs text-red-600">
              CUFE PROVISIONAL - Pendiente autorizaci&oacute;n DIAN
            </p>
          )}
          {invoice.cufeOfficial && (
            <p className="mt-1 text-xs text-green-600">
              CUFE OFICIAL - Transmitido a DIAN
            </p>
          )}
        </div>

        <div className="border-t border-gray-100 pt-3 space-y-1">
          <DetailRow label="Emisión" value={new Date(invoice.issuedAt).toLocaleString('es-CO')} />
          <DetailRow label="Vence" value={invoice.expiresAt ? new Date(invoice.expiresAt).toLocaleString('es-CO') : '—'} />
          {invoice.transmittedAt && (
            <DetailRow label="Transmitido" value={new Date(invoice.transmittedAt).toLocaleString('es-CO')} />
          )}
        </div>

        {actionMsg && (
          <div className={`rounded p-2 text-xs ${
            actionMsg.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
          }`}>
            {actionMsg}
          </div>
        )}

        <div className="border-t border-gray-100 pt-3 space-y-2">
          <button
            className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={handleReprint}
          >
            Reimprimir recibo
          </button>

          {isCancellable && (
            <button
              className="w-full rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? 'Anulando…' : 'Anular factura'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const DetailRow: FC<{ label: string; value: string; mono?: boolean; badge?: boolean }> = ({
  label, value, mono, badge,
}) => (
  <div className="flex items-start justify-between">
    <span className="text-xs font-medium text-gray-500">{label}</span>
    {badge ? (
      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
        {value}
      </span>
    ) : (
      <span className={`text-right ${mono ? 'font-mono text-xs' : 'text-xs'} text-gray-900`}>
        {value}
      </span>
    )}
  </div>
);
