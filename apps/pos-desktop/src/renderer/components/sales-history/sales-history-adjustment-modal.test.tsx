/**
 * Component tests for SalesHistoryAdjustmentModal.
 *
 * Verifies the wrapper loads the client catalog and submits a CLIENT_CHANGE
 * adjustment through the generic AdjustmentCreationModal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SalesHistoryAdjustmentModal } from './sales-history-adjustment-modal';
import type { OperationalInvoiceView } from '../../../domain/fiscal/local-adjustment.types';
import '@/i18n';

// ---------------------------------------------------------------------------
// Service-context mock
// ---------------------------------------------------------------------------

const mockClientsService = {
  search: vi.fn(),
};

const mockCashShiftService = {
  getActivePaymentMethodsList: vi.fn().mockResolvedValue([]),
};

(globalThis as Record<string, unknown>).__mockClientsService = mockClientsService;
(globalThis as Record<string, unknown>).__mockCashShiftService = mockCashShiftService;

vi.mock('../common/service-context', () => ({
  useClientsService: () => (globalThis as Record<string, unknown>).__mockClientsService,
  useCashShiftService: () => (globalThis as Record<string, unknown>).__mockCashShiftService,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createOperationalView = (
  client: Partial<OperationalInvoiceView['operational']['client']> = {},
): OperationalInvoiceView => ({
  fiscal: {
    id: 'inv-1',
    invoiceNumber: 'FE0001',
    invoiceType: 'ELECTRONIC_INVOICE',
    status: 'TRANSMITTED_AUTHORIZED',
    cufeProvisional: 'cufe-1',
    cufeOfficial: null,
    issuedAt: '2026-07-20T10:00:00.000Z',
    fullData: {} as unknown as OperationalInvoiceView['fiscal']['fullData'],
  },
  operational: {
    client: {
      clientId: 'client-1',
      name: 'Juan Pérez',
      identificationType: 'CC',
      identificationNumber: '123456',
      ...client,
    },
    payments: [],
    notes: [],
    contactInfo: { email: null, phone: null, address: null },
    tags: [],
    customFields: {},
    deliveryInfo: null,
    hasDifferences: false,
  },
});

const defaultProps = {
  visible: true,
  saleId: 'sale-1',
  invoiceId: 'inv-1',
  invoiceStatus: 'TRANSMITTED_AUTHORIZED',
  operationalView: createOperationalView(),
  allowedTypes: ['CLIENT_CHANGE' as const],
  loading: false,
  error: null as string | null,
  onSubmit: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SalesHistoryAdjustmentModal', () => {
  beforeEach(() => {
    mockClientsService.search.mockResolvedValue([
      {
        id: 'client-2',
        fullName: 'Ana Gómez',
        identificationType: 'CC',
        identificationNumber: '654321',
        email: null,
        phone: null,
        address: null,
      },
    ]);
  });

  it('loads clients and submits a CLIENT_CHANGE adjustment', async () => {
    render(<SalesHistoryAdjustmentModal {...defaultProps} />);

    expect(mockClientsService.search).toHaveBeenCalledTimes(1);
    await act(async () => {
      await mockClientsService.search.mock.results[0].value;
    });

    const clientChangeButton = screen.getByRole('radio', {
      name: /Cambio de cliente asociado/,
    });
    await userEvent.click(clientChangeButton);

    const searchInput = await screen.findByPlaceholderText(
      /Buscar por nombre o documento/,
    );
    await userEvent.click(searchInput);

    const option = await screen.findByRole('option', { name: /Ana Gómez/ });
    await userEvent.click(option);

    const reasonInput = await screen.findByPlaceholderText(/Describa el motivo/);
    await userEvent.type(
      reasonInput,
      'Corrección de cliente asociado a la venta',
    );

    await userEvent.click(screen.getByRole('button', { name: /Continuar/ }));

    expect(
      screen.getByRole('button', { name: /Aplicar ajuste/ }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Aplicar ajuste/ }));

    await waitFor(() => {
      expect(defaultProps.onSubmit).toHaveBeenCalledTimes(1);
    });

    const [type, value, reason] = defaultProps.onSubmit.mock.calls[0] as [
      string,
      Record<string, string>,
      string,
    ];

    expect(type).toBe('CLIENT_CHANGE');
    expect(value).toMatchObject({
      clientId: 'client-2',
      name: 'Ana Gómez',
      identificationType: 'CC',
      identificationNumber: '654321',
    });
    expect(reason).toBe('Corrección de cliente asociado a la venta');
  }, 15000);
});
