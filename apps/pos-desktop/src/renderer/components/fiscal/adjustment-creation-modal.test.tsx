/**
 * Component tests for AdjustmentCreationModal — CLIENT_CHANGE branch.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdjustmentCreationModal } from './adjustment-creation-modal';
import type { ClientOption } from './adjustment-creation-modal';
import type { PaymentMethodOption } from '@/store/slices/payment-types';
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

// DB-backed payment methods (DIAN categories) — mirror the local
// PaymentMethod rows that the shared picker renders in production.
const paymentMethods: PaymentMethodOption[] = [
  { id: 'pm-cash', category: 'CASH', name: 'Efectivo', isCash: true },
  {
    id: 'pm-debit',
    category: 'DEBIT_CARD',
    name: 'Tarjeta Débito',
    isCash: false,
  },
  {
    id: 'pm-credit',
    category: 'CREDIT_CARD',
    name: 'Tarjeta Crédito',
    isCash: false,
  },
  {
    id: 'pm-transfer',
    category: 'BANK_TRANSFER',
    name: 'Transferencia Bancaria',
    isCash: false,
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
  }, 15000);
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
    paymentMethods,
  };

  it('renders the method picker as a DB-driven select with an optional specific-name input', async () => {
    render(<AdjustmentCreationModal {...paymentProps} />);

    await userEvent.click(
      screen.getByRole('radio', { name: /Cambio m.*todo de pago/ }),
    );

    // The method picker is a <select> driven by the active PaymentMethod
    // rows from the local DB (DIAN categories), not a free-text input.
    // Querying by the picker label returns the <select> element.
    const methodSelect = screen.getByLabelText(
      /M.todo de pago|Payment method/,
    ) as HTMLSelectElement;
    expect(methodSelect.tagName).toBe('SELECT');

    // Every active DB method is offered as an option — there is no
    // free-text category input and no hardcoded list.
    const optionValues = Array.from(methodSelect.options).map((o) => o.value);
    expect(optionValues).toEqual(
      expect.arrayContaining(['pm-cash', 'pm-debit', 'pm-credit', 'pm-transfer']),
    );

    // Optional cashier-entered specific name is a separate text input below
    // the picker.
    const specificNameInput = screen.getByLabelText(
      /Nombre espec.fico|Specific name/,
    );
    expect(specificNameInput.tagName).toBe('INPUT');
    expect(specificNameInput).toHaveAttribute('type', 'text');

    // No editable <input> for the amount — only the read-only amount display.
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

  it('submits the flat single-method shape with the real DB method and its category', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AdjustmentCreationModal {...paymentProps} onSubmit={onSubmit} />);

    await userEvent.click(
      screen.getByRole('radio', { name: /Cambio m.*todo de pago/ }),
    );

    // Single method picker — selecting a DB method stores its real
    // `paymentMethodId` and derives `category` from the DB row.
    const methodSelect = screen.getByLabelText(
      /M.todo de pago|Payment method/,
    ) as HTMLSelectElement;
    await userEvent.selectOptions(methodSelect, 'pm-credit');

    // Optional cashier-entered specific name — separate from the category.
    // The DB method name is pre-filled by the picker; an empty override
    // reverts to that default, so set the full value at once.
    const specificNameInput = screen.getByLabelText(
      /Nombre espec.fico|Specific name/,
    );
    fireEvent.change(specificNameInput, { target: { value: 'Tarjeta Visa' } });

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
    // `category` is the enum value from the select, not a free-form string.
    // `paymentMethodName` is the cashier-entered override (may be empty when
    // the cashier leaves the optional field blank — verified separately).
    expect(value).toMatchObject({
      paymentMethodName: 'Tarjeta Visa',
      category: 'CREDIT_CARD',
      paymentMethodId: 'pm-credit',
    });
    expect(reason).toBe('Cambio a tarjeta de crédito por solicitud del cliente');
  }, 15000);

  it('shows reference fields only for categories that carry reference data', async () => {
    render(<AdjustmentCreationModal {...paymentProps} />);

    await userEvent.click(
      screen.getByRole('radio', { name: /Cambio m.*todo de pago/ }),
    );

    const methodSelect = screen.getByLabelText(
      /M.todo de pago|Payment method/,
    ) as HTMLSelectElement;

    // CASH carries no reference data — no reference inputs are rendered.
    await userEvent.selectOptions(methodSelect, 'pm-cash');
    expect(
      screen.queryByLabelText(/Referencia \/ CUS|Reference \/ CUS/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/C.digo de autorizaci.n|Authorization code/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Marca de tarjeta|Card brand/),
    ).not.toBeInTheDocument();

    // BANK_TRANSFER exposes a single transaction reference field.
    await userEvent.selectOptions(methodSelect, 'pm-transfer');
    expect(
      screen.getByLabelText(/Referencia \/ CUS|Reference \/ CUS/),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/C.digo de autorizaci.n|Authorization code/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Marca de tarjeta|Card brand/),
    ).not.toBeInTheDocument();

    // CREDIT_CARD exposes auth code, brand, and last-4 — no transaction
    // reference. Switching categories removes the now-irrelevant field.
    await userEvent.selectOptions(methodSelect, 'pm-credit');
    expect(
      screen.queryByLabelText(/Referencia \/ CUS|Reference \/ CUS/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText(/C.digo de autorizaci.n|Authorization code/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Marca de tarjeta|Card brand/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/.ltimos 4 d.gitos|Last 4 digits/),
    ).toBeInTheDocument();
  });
});
