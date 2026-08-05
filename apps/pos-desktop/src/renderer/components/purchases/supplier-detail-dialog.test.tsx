/**
 * Component tests for SupplierDetailDialog.
 *
 * Covers: rendering nothing when closed, supplier identity (business name,
 * NIT, contact info), dashes for missing optional fields, active/inactive
 * status badges, and the edit hand-off / Esc-to-close interactions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupplierDetailDialog } from './supplier-detail-dialog';
import type { SupplierSearchResult } from '../../../domain/purchases';

// i18n singleton initialized via vitest.setup.ts (Spanish by default)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSupplier(
  overrides: Partial<SupplierSearchResult> = {},
): SupplierSearchResult {
  return {
    id: 'supplier-1',
    identificationType: 'NIT',
    identificationNumber: '900123456-7',
    businessName: 'Distribuidora Farmacéutica S.A.S.',
    contactName: 'Carlos Méndez',
    phone: '3109876543',
    email: 'carlos@distrifarma.com',
    address: 'Cra 15 #45-67',
    city: 'Medellín',
    country: 'Colombia',
    isActive: true,
    paymentTermsDays: 30,
    creditLimit: 5000000,
    ...overrides,
  };
}

function setup(
  supplier: SupplierSearchResult | null,
) {
  const onClose = vi.fn();
  const onEdit = vi.fn();
  render(
    <SupplierDetailDialog supplier={supplier} onClose={onClose} onEdit={onEdit} />,
  );
  return { onClose, onEdit };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SupplierDetailDialog', () => {
  describe('open state', () => {
    it('renders nothing when supplier is null', () => {
      setup(null);

      expect(
        screen.queryByText('Distribuidora Farmacéutica S.A.S.'),
      ).not.toBeInTheDocument();
    });

    it('renders the supplier identity when open', () => {
      setup(makeSupplier());

      // Modal eyebrow heading + identity
      expect(screen.getByText('Detalles del proveedor')).toBeInTheDocument();
      expect(
        screen.getByText('Distribuidora Farmacéutica S.A.S.'),
      ).toBeInTheDocument();
      expect(screen.getByText('NIT')).toBeInTheDocument();
      expect(screen.getByText('900123456-7')).toBeInTheDocument();
      expect(screen.getByText('Carlos Méndez')).toBeInTheDocument();
      expect(screen.getByText('carlos@distrifarma.com')).toBeInTheDocument();
      expect(screen.getByText('3109876543')).toBeInTheDocument();
      expect(screen.getByText('Cra 15 #45-67')).toBeInTheDocument();
      expect(screen.getByText('Medellín, Colombia')).toBeInTheDocument();
    });
  });

  describe('optional fields', () => {
    it('renders dashes for missing optional fields', () => {
      setup(
        makeSupplier({
          contactName: null,
          email: null,
          phone: null,
          address: null,
          city: null,
        }),
      );

      const dashes = screen.getAllByText('—');
      expect(dashes.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('status badge', () => {
    it('shows the active badge for an active supplier', () => {
      setup(makeSupplier({ isActive: true }));

      expect(screen.getByText('Activo')).toBeInTheDocument();
      expect(screen.queryByText('Inactivo')).not.toBeInTheDocument();
    });

    it('shows the inactive badge for an inactive supplier', () => {
      setup(makeSupplier({ isActive: false }));

      expect(screen.getByText('Inactivo')).toBeInTheDocument();
      expect(screen.queryByText('Activo')).not.toBeInTheDocument();
    });
  });

  describe('commercial terms', () => {
    it('renders payment terms days and credit limit', () => {
      setup(makeSupplier());

      // "30 días" and formatted credit limit ($5,000,000 in es-CO)
      expect(screen.getByText('30', { exact: false })).toBeInTheDocument();
      expect(screen.getByText(/\$5\.000\.000/)).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onEdit with the supplier when the edit button is clicked', async () => {
      const user = userEvent.setup();
      const supplier = makeSupplier();
      const { onEdit } = setup(supplier);

      await user.click(screen.getByRole('button', { name: 'Editar proveedor' }));

      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onEdit).toHaveBeenCalledWith(supplier);
    });

    it('calls onClose when Escape is pressed', async () => {
      const user = userEvent.setup();
      const { onClose } = setup(makeSupplier());

      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when the X button is clicked', async () => {
      const user = userEvent.setup();
      const { onClose } = setup(makeSupplier());

      await user.click(screen.getAllByRole('button', { name: 'Cerrar' })[0]);

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});