/**
 * Component tests for AdjustmentCreationModal — CLIENT_CHANGE branch.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdjustmentCreationModal } from './adjustment-creation-modal';
import type { ClientOption } from './adjustment-creation-modal';
import type { OperationalInvoiceView } from '../../../domain/fiscal/local-adjustment.types';
import '@/i18n';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createOperationalView = (
  client: Partial<OperationalInvoiceView['operational']['client']> = {},
  fiscalTotal = '50000.00',
  payments: OperationalInvoiceView['operational']['payments'] = [],
): OperationalInvoiceView => ({
  fiscal: {
    id: 'inv-1',
    invoiceNumber: 'FE0001',
    invoiceType: 'ELECTRONIC_INVOICE',
    status: 'TRANSMITTED_AUTHORIZED',
    cufeProvisional: 'cufe-1',
    cufeOfficial: null,
    issuedAt: '2026-07-20T10:00:00.000Z',
    fullData: {
      totalAmount: fiscalTotal,
    } as unknown as OperationalInvoiceView['fiscal']['fullData'],
  },
  operational: {
    client: {
      clientId: 'client-1',
      name: 'Juan Pérez',
      identificationType: 'CC',
      identificationNumber: '123456',
      ...client,
    },
    payments,
    notes: [],
    contactInfo: { email: null, phone: null, address: null },
    tags: [],
    customFields: {},
    deliveryInfo: null,
    hasDifferences: false,
  },
});

const clients: ClientOption[] = [
  {
    id: 'client-2',
    name: 'Ana Gómez',
    identificationType: 'CC',
    identificationNumber: '654321',
  },
];

const defaultProps = {
  visible: true,
  invoiceId: 'inv-1',
  invoiceStatus: 'TRANSMITTED_AUTHORIZED',
  operationalView: createOperationalView(),
  allowedTypes: ['CLIENT_CHANGE' as const],
  loading: false,
  error: null as string | null,
  clients,
  onSubmit: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AdjustmentCreationModal — CLIENT_CHANGE', () => {
  it('renders the client picker when CLIENT_CHANGE is selected', async () => {
    render(<AdjustmentCreationModal {...defaultProps} />);

    await userEvent.click(
      screen.getByRole('radio', { name: /Cambio de cliente asociado/ }),
    );

    expect(
      screen.getByPlaceholderText(/Buscar por nombre o documento/),
    ).toBeInTheDocument();
  });

  it('validates the reason before allowing continue', async () => {
    render(<AdjustmentCreationModal {...defaultProps} />);

    await userEvent.click(
      screen.getByRole('radio', { name: /Cambio de cliente asociado/ }),
    );

    const searchInput = screen.getByPlaceholderText(
      /Buscar por nombre o documento/,
    );
    await userEvent.click(searchInput);
    await userEvent.click(
      screen.getByRole('option', { name: /Ana Gómez/ }),
    );

    const reasonInput = screen.getByPlaceholderText(/Describa el motivo/);
    await userEvent.type(reasonInput, 'corto');

    const continueButton = screen.getByRole('button', { name: /Continuar/ });
    expect(continueButton).toBeDisabled();

    await userEvent.clear(reasonInput);
    await userEvent.type(
      reasonInput,
      'Corrección de cliente asociado a la venta',
    );

    expect(continueButton).not.toBeDisabled();
  });

  it('submits the correct CLIENT_CHANGE shape', async () => {
    render(<AdjustmentCreationModal {...defaultProps} />);

    await userEvent.click(
      screen.getByRole('radio', { name: /Cambio de cliente asociado/ }),
    );

    await userEvent.click(
      screen.getByPlaceholderText(/Buscar por nombre o documento/),
    );
    await userEvent.click(
      screen.getByRole('option', { name: /Ana Gómez/ }),
    );

    await userEvent.type(
      screen.getByPlaceholderText(/Describa el motivo/),
      'Corrección de cliente asociado a la venta',
    );

    await userEvent.click(screen.getByRole('button', { name: /Continuar/ }));

    await userEvent.click(
      screen.getByRole('button', { name: /Aplicar ajuste/ }),
    );

    expect(defaultProps.onSubmit).toHaveBeenCalledTimes(1);

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
  });
});

describe('AdjustmentCreationModal — PAYMENT_METHOD_CHANGE', () => {
  const paymentView = createOperationalView(
    {},
    '75000.00',
    [
      {
        paymentMethodId: 'pm-cash',
        paymentMethodName: 'Efectivo',
        amount: '75000.00',
        category: 'CASH',
        transactionReference: null,
        authorizationCode: null,
        cardBrand: null,
        cardLastFour: null,
      },
    ],
  );

  const paymentProps = {
    ...defaultProps,
    allowedTypes: ['PAYMENT_METHOD_CHANGE' as const],
    operationalView: paymentView,
  };

  it('renders the method editor without an editable amount input', async () => {
    render(<AdjustmentCreationModal {...paymentProps} />);

    await userEvent.click(
      screen.getByRole('radio', { name: /Cambio m.*todo de pago/ }),
    );

    // Method name is editable (label is just "M" todo")
    expect(
      screen.getByLabelText(/^M.todo$/),
    ).toBeInTheDocument();
    // Category select is editable
    expect(
      screen.getByLabelText(/Categor.a/),
    ).toBeInTheDocument();
    // No editable amount input — the only amount rendered is a read-only
    // span showing the fiscal total. There is no <input> for amount.
    expect(
      screen.queryByLabelText(/^Monto$/),
    ).not.toBeInTheDocument();
    // The read-only amount display IS present (has aria-label "Monto (de la factura fiscal)")
    expect(
      screen.getByLabelText(/Monto \(de la factura fiscal\)/),
    ).toBeInTheDocument();
  });

  it('shows the fiscal total as a read-only amount display', async () => {
    render(<AdjustmentCreationModal {...paymentProps} />);

    await userEvent.click(
      screen.getByRole('radio', { name: /Cambio m.*todo de pago/ }),
    );

    // The locked amount is shown as plain text in the readonly region
    expect(screen.getByText(/\$ ?75[.,]000[.,]00/)).toBeInTheDocument();
  });

  it('submits the flat single-method shape without an amount field', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AdjustmentCreationModal {...paymentProps} onSubmit={onSubmit} />);

    await userEvent.click(
      screen.getByRole('radio', { name: /Cambio m.*todo de pago/ }),
    );

    const methodInput = screen.getByLabelText(/^M.todo$/);
    await userEvent.clear(methodInput);
    await userEvent.type(methodInput, 'Tarjeta Crédito');

    const categorySelect = screen.getByLabelText(/Categor.a/) as HTMLSelectElement;
    await userEvent.selectOptions(categorySelect, 'CARD');

    await userEvent.type(
      screen.getByPlaceholderText(/Describa el motivo/),
      'Cambio a tarjeta de crédito por solicitud del cliente',
    );

    await userEvent.click(screen.getByRole('button', { name: /Continuar/ }));
    await userEvent.click(
      screen.getByRole('button', { name: /Aplicar ajuste/ }),
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [type, value, reason] = onSubmit.mock.calls[0] as [
      string,
      Record<string, unknown>,
      string,
    ];

    expect(type).toBe('PAYMENT_METHOD_CHANGE');
    // Flat shape: no `payments` array, no `amount` field
    expect(value).not.toHaveProperty('payments');
    expect(value).not.toHaveProperty('amount');
    expect(value).toMatchObject({
      paymentMethodName: 'Tarjeta Crédito',
      category: 'CARD',
    });
    expect(typeof (value as { paymentMethodId?: string }).paymentMethodId)
      .toBe('string');
    expect(reason).toBe('Cambio a tarjeta de crédito por solicitud del cliente');
  });
});
