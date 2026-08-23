/**
 * Component tests for CompanySetupGate — the "configure your company to
 * invoice" gate with its configure/later actions.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompanySetupGate } from './company-setup-gate';

describe('CompanySetupGate', () => {
  it('renders the gate copy and a primary configure action', () => {
    render(<CompanySetupGate onConfigure={vi.fn()} />);

    expect(
      screen.getByRole('heading', {
        name: 'Configura tu empresa para facturar',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Para emitir facturación electrónica \(DIAN\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Configurar ahora' }),
    ).toBeInTheDocument();
  });

  it('calls onConfigure when the primary action is clicked', async () => {
    const user = userEvent.setup();
    const onConfigure = vi.fn();
    render(<CompanySetupGate onConfigure={onConfigure} />);

    await user.click(screen.getByRole('button', { name: 'Configurar ahora' }));

    expect(onConfigure).toHaveBeenCalledTimes(1);
  });

  it('renders and calls the later action when provided', async () => {
    const user = userEvent.setup();
    const onConfigure = vi.fn();
    const onLater = vi.fn();
    render(<CompanySetupGate onConfigure={onConfigure} onLater={onLater} />);

    const laterButton = screen.getByRole('button', { name: 'Lo haré después' });
    expect(laterButton).toBeInTheDocument();

    await user.click(laterButton);

    expect(onLater).toHaveBeenCalledTimes(1);
    expect(onConfigure).not.toHaveBeenCalled();
  });

  it('omits the later action when not provided', () => {
    render(<CompanySetupGate onConfigure={vi.fn()} />);

    expect(
      screen.queryByRole('button', { name: 'Lo haré después' }),
    ).not.toBeInTheDocument();
  });
});