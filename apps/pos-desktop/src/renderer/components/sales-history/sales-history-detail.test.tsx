/**
 * Component tests for SalesHistoryDetail.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SalesHistoryDetail } from './sales-history-detail';
import type { SaleHistoryDetail } from '../../../domain/sales-pos/sales-history.service';
import type { OperationalInvoiceView } from '../../../domain/fiscal/local-adjustment.types';
import type { InvoiceType, InvoiceStatus } from '../../../domain/fiscal/fiscal-types';
import '@/i18n';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createInvoice = () => ({
  id: 'inv-1',
  saleId: 'sale-1',
  workstationId: 'ws-1',
  invoiceType: 'ELECTRONIC_INVOICE' as InvoiceType,
  invoiceNumber: 'FE0001',
  contingencyNumber: null,
  status: 'TRANSMITTED_AUTHORIZED' as InvoiceStatus,
  cufeProvisional: 'cufe-1',
  cufeOfficial: null,
  issuedAt: new Date('2026-07-20T10:00:00Z'),
  transmittedAt: new Date('2026-07-20T10:00:00Z'),
  expiresAt: new Date('2026-08-20T10:00:00Z'),
  fiscalXml: null,
  fiscalPdfPath: null,
  relatedInvoiceId: null,
  contingencyEventId: null,
  techKeySnapshot: 'tech-1',
  fullData: {
    invoiceType: 'ELECTRONIC_INVOICE',
    invoiceNumber: 'FE0001',
    contingencyNumber: null,
    relatedInvoiceNumber: null,
    seller: {
      nit: '123456789',
      name: 'Droguería Prueba',
      address: null,
      phone: null,
      resolutionNumber: null,
      resolutionDate: null,
      resolutionPrefix: 'FE',
    },
    buyer: {
      name: 'Juan Pérez',
      identificationType: 'CC',
      identificationNumber: '123456',
      email: null,
      phone: null,
      address: null,
    },
    lineItems: [],
    taxSummaries: [],
    payments: [],
    subtotal: '100.00',
    totalDiscount: '0.00',
    totalTax: '19.00',
    totalAmount: '119.00',
    changeAmount: '0.00',
    issuedAt: '2026-07-20T10:00:00.000Z',
    currency: 'COP',
    prescriptionNumber: null,
    workstationCode: 'WS-01',
  },
});

const createDetail = (
  overrides: Partial<SaleHistoryDetail> = {},
): SaleHistoryDetail => ({
  sale: {
    id: 'sale-1',
    localNumber: '100',
    confirmedAt: '2026-07-20T10:00:00.000Z',
    subtotal: '100.00',
    totalDiscount: '0.00',
    totalTax: '19.00',
    totalAmount: '119.00',
    changeAmount: '0.00',
    clientId: 'client-1',
    clientNameSnapshot: 'Juan Pérez',
    clientIdentificationTypeSnapshot: 'CC',
    clientIdentificationNumberSnapshot: '123456',
    cashShiftId: 'cs-1',
    workstationId: 'ws-1',
    userId: 'user-1',
    delivery: null,
    items: [],
    payments: [],
  },
  invoices: [createInvoice()],
  mainInvoiceOperationalView: null,
  adjustmentHistory: [],
  ...overrides,
});

const createOperationalView = (
  client: Partial<OperationalInvoiceView['operational']['client']> = {},
  hasDifferences = false,
): OperationalInvoiceView => ({
  fiscal: {
    id: 'inv-1',
    invoiceNumber: 'FE0001',
    invoiceType: 'ELECTRONIC_INVOICE',
    status: 'TRANSMITTED_AUTHORIZED' as InvoiceStatus,
    cufeProvisional: 'cufe-1',
    cufeOfficial: null,
    issuedAt: '2026-07-20T10:00:00.000Z',
    fullData: {} as unknown as OperationalInvoiceView['fiscal']['fullData'],
  },
  operational: {
    client: {
      clientId: null,
      name: null,
      identificationType: null,
      identificationNumber: null,
      ...client,
    },
    payments: [],
    notes: [],
    contactInfo: { email: null, phone: null, address: null },
    tags: [],
    customFields: {},
    deliveryInfo: null,
    hasDifferences,
  },
});

const defaultProps = {
  saleId: 'sale-1',
  detail: createDetail(),
  loading: false,
  viewMode: 'fiscal' as const,
  operationalView: null as OperationalInvoiceView | null,
  adjustmentHistory: [],
  adjustmentHistoryLoading: false,
  onViewModeChange: vi.fn(),
  onClose: vi.fn(),
  onCreateAdjustment: vi.fn(),
  onReprint: vi.fn(),
  onCancelInvoice: vi.fn(),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SalesHistoryDetail', () => {
  it('renders fiscal and operational tabs', () => {
    render(<SalesHistoryDetail {...defaultProps} />);

    expect(
      screen.getByRole('tab', { name: /Fiscal \(DIAN\)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: /Operativa \(droguería\)/ }),
    ).toBeInTheDocument();
  });

  it('shows the fiscal client in the fiscal tab', () => {
    render(<SalesHistoryDetail {...defaultProps} viewMode="fiscal" />);

    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
  });

  it('shows the operational client override in the operational tab', async () => {
    render(
      <SalesHistoryDetail
        {...defaultProps}
        viewMode="operational"
        operationalView={createOperationalView(
          {
            clientId: 'client-2',
            name: 'Ana Gómez',
            identificationType: 'CC',
            identificationNumber: '654321',
          },
          true,
        )}
      />,
    );

    expect(screen.getByText('Ana Gómez')).toBeInTheDocument();
    expect(screen.getByText(/Esta venta tiene ajustes operativos/)).toBeInTheDocument();
  });

  it('calls onCreateAdjustment when the adjust button is clicked', async () => {
    const onCreateAdjustment = vi.fn();
    render(
      <SalesHistoryDetail
        {...defaultProps}
        viewMode="operational"
        operationalView={createOperationalView()}
        onCreateAdjustment={onCreateAdjustment}
      />,
    );

    const adjustButtons = screen.getAllByRole('button', {
      name: /Aplicar ajuste/,
    });
    await userEvent.click(adjustButtons[0] as HTMLElement);

    expect(onCreateAdjustment).toHaveBeenCalledTimes(1);
  });
});
