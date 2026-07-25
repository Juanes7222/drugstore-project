/**
 * Component tests for SalesHistoryEmpty.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SalesHistoryEmpty } from './sales-history-empty';
import '@/i18n';

describe('SalesHistoryEmpty', () => {
  it('renders the reset action when filters are present', () => {
    render(<SalesHistoryEmpty hasFilters={true} onReset={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: /Limpiar filtros/ }),
    ).toBeInTheDocument();
  });

  it('does not render the reset action when no filters are present', () => {
    render(<SalesHistoryEmpty hasFilters={false} onReset={vi.fn()} />);

    expect(
      screen.queryByRole('button', { name: /Limpiar filtros/ }),
    ).not.toBeInTheDocument();
  });

  it('calls onReset when the reset button is clicked', async () => {
    const onReset = vi.fn();
    render(<SalesHistoryEmpty hasFilters={true} onReset={onReset} />);

    await userEvent.click(
      screen.getByRole('button', { name: /Limpiar filtros/ }),
    );

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
