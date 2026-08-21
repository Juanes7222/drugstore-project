/**
 * Component tests for SalesHistoryList.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SalesHistoryList } from './sales-history-list';
import type { SaleHistoryListItem } from '../../../domain/sales-pos/sales-history.service';
import { ExportFormat } from '../../../common/export';
import es from '../../i18n/locales/es.json';
import '@/i18n';

// ExportMenu (rendered when onExport is provided) mounts with motion
// animations; force reduced motion so the menu unmounts synchronously.
vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return { ...actual, useReducedMotion: () => true };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createSale = (
  overrides: Partial<SaleHistoryListItem> = {},
): SaleHistoryListItem => ({
  saleId: 'sale-1',
  localNumber: '100',
  confirmedAt: '2026-07-20T10:00:00.000Z',
  totalAmount: '119.00',
  clientName: 'Juan Pérez',
  clientIdentificationNumber: '123456',
  invoiceId: 'inv-1',
  invoiceNumber: 'FE0001',
  invoiceStatus: 'TRANSMITTED_AUTHORIZED',
  invoiceType: 'ELECTRONIC_INVOICE',
  hasAdjustments: false,
  deliveryFeeCents: 0,
  deliveryAddress: null,
  ...overrides,
});

const defaultProps = {
  sales: [createSale()],
  totalCount: 1,
  loading: false,
  filters: {},
  onSelect: vi.fn(),
  onRefresh: vi.fn(),
  onFiltersChange: vi.fn(),
  onLoadMore: vi.fn(),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SalesHistoryList', () => {
  it('renders sale rows with number, client, total and status', () => {
    render(<SalesHistoryList {...defaultProps} />);

    expect(screen.getByText('#100')).toBeInTheDocument();
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
    expect(screen.getByText('FE0001')).toBeInTheDocument();
    expect(screen.getByText('Autorizado DIAN')).toBeInTheDocument();
  });

  it('debounces the search input and notifies the parent with the query', () => {
    vi.useFakeTimers();
    try {
      const onFiltersChange = vi.fn();
      render(<SalesHistoryList {...defaultProps} onFiltersChange={onFiltersChange} />);

      const searchInput = screen.getByLabelText(/Buscar venta, cliente o factura/);
      fireEvent.change(searchInput, { target: { value: '100' } });

      // Debounce window not elapsed yet — no query fired.
      expect(onFiltersChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);

      expect(onFiltersChange).toHaveBeenCalledWith({ query: '100' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the query when the search input is emptied', () => {
    vi.useFakeTimers();
    try {
      const onFiltersChange = vi.fn();
      render(<SalesHistoryList {...defaultProps} onFiltersChange={onFiltersChange} />);

      const searchInput = screen.getByLabelText(/Buscar venta, cliente o factura/);
      fireEvent.change(searchInput, { target: { value: '100' } });
      vi.advanceTimersByTime(300);

      expect(onFiltersChange).toHaveBeenLastCalledWith({ query: '100' });

      fireEvent.change(searchInput, { target: { value: '' } });
      vi.advanceTimersByTime(300);

      expect(onFiltersChange).toHaveBeenLastCalledWith({ query: undefined });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows empty state when there are no sales', () => {
    render(<SalesHistoryList {...defaultProps} sales={[]} totalCount={0} />);

    expect(screen.getByText('No hay ventas confirmadas')).toBeInTheDocument();
  });

  it('calls onSelect when the detail button is clicked', async () => {
    const onSelect = vi.fn();
    render(<SalesHistoryList {...defaultProps} onSelect={onSelect} />);

    const detailButton = screen.getByRole('button', {
      name: /Detalle de venta/,
    });
    await userEvent.click(detailButton);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('sale-1');
  });

  it('renders the export menu in the header when onExport is provided', () => {
    render(<SalesHistoryList {...defaultProps} onExport={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: es.export.menu.label }),
    ).toBeInTheDocument();
  });

  it.each([
    { format: ExportFormat.EXCEL, label: es.export.menu.excel },
    { format: ExportFormat.CSV, label: es.export.menu.csv },
    { format: ExportFormat.PDF, label: es.export.menu.pdf },
    { format: ExportFormat.PRINT, label: es.export.menu.print },
  ] as const)('forwards the $format selection to onExport', async ({ format, label }) => {
    const onExport = vi.fn();
    render(<SalesHistoryList {...defaultProps} onExport={onExport} />);

    await userEvent.click(
      screen.getByRole('button', { name: es.export.menu.label }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: label }));

    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledWith(format);
  });

  it('disables the export trigger while an export is running', () => {
    render(
      <SalesHistoryList {...defaultProps} onExport={vi.fn()} isExporting />,
    );

    expect(
      screen.getByRole('button', { name: es.export.menu.label }),
    ).toBeDisabled();
  });

  it('does not render an export menu when onExport is omitted', () => {
    render(<SalesHistoryList {...defaultProps} />);

    expect(
      screen.queryByRole('button', { name: es.export.menu.label }),
    ).not.toBeInTheDocument();
  });
});
