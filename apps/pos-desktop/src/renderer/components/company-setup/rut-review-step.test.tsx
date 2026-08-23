/**
 * Component tests for RutReviewStep — the editable identity/location/contact
 * ledger with the NIT-DV validation badge.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RutReviewStep, type DvStatus } from './rut-review-step';
import type { CompanyDraft } from '@/hooks/use-company-setup';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeDraft = (overrides: Partial<CompanyDraft> = {}): CompanyDraft => ({
  nit: '900123456',
  dv: '8',
  name: 'FARMACIA LOS ANDES S.A.S.',
  regimen: 'RÉGIMEN COMÚN',
  organizationType: 'PERSONA JURÍDICA',
  ciiu: '4773',
  municipio: 'MEDELLÍN',
  municipioCode: '05001',
  departamento: 'ANTIOQUIA',
  address: 'CRA 45 # 12-34',
  phone: '604 444 5678',
  email: 'contacto@farmaciaandesa.com',
  resolutionNumber: null,
  resolutionDate: null,
  resolutionPrefix: 'FE',
  resolutionRangeStart: null,
  resolutionRangeEnd: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RutReviewStep', () => {
  it('renders every editable identity field from the draft', () => {
    render(
      <RutReviewStep
        draft={makeDraft()}
        isManual={false}
        dvStatus="valid"
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('NIT (DV)')).toHaveValue('900123456');
    expect(screen.getByLabelText('DV')).toHaveValue('8');
    expect(screen.getByLabelText('Razón social')).toHaveValue(
      'FARMACIA LOS ANDES S.A.S.',
    );
    expect(screen.getByLabelText('Régimen tributario')).toHaveValue(
      'RÉGIMEN COMÚN',
    );
    expect(screen.getByLabelText('CIIU')).toHaveValue('4773');
    expect(screen.getByLabelText('Municipio')).toHaveValue('MEDELLÍN');
    expect(screen.getByLabelText('Departamento')).toHaveValue('ANTIOQUIA');
    expect(screen.getByLabelText('Dirección')).toHaveValue('CRA 45 # 12-34');
    expect(screen.getByLabelText('Teléfono')).toHaveValue('604 444 5678');
    expect(screen.getByLabelText('Correo electrónico')).toHaveValue(
      'contacto@farmaciaandesa.com',
    );
  });

  it('renders nullable fields as empty inputs', () => {
    render(
      <RutReviewStep
        draft={makeDraft({ ciiu: null, municipio: null, municipioCode: null })}
        isManual={false}
        dvStatus="unknown"
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('CIIU')).toHaveValue('');
    expect(screen.getByLabelText('Municipio')).toHaveValue('');
    expect(screen.getByLabelText('Código de municipio')).toHaveValue('');
  });

  it.each(['valid', 'invalid', 'unknown'] as DvStatus[])(
    'shows the %s DV badge',
    (dvStatus) => {
      render(
        <RutReviewStep
          draft={makeDraft()}
          isManual={false}
          dvStatus={dvStatus}
          onFieldChange={vi.fn()}
        />,
      );

      const label =
        dvStatus === 'valid'
          ? 'DV válido'
          : dvStatus === 'invalid'
            ? 'DV inválido'
            : 'DV sin validar';
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(label).closest('[role="status"]')).not.toBeNull();
    },
  );

  it('labels the source banner as extracted when the RUT was parsed', () => {
    render(
      <RutReviewStep
        draft={makeDraft()}
        isManual={false}
        dvStatus="valid"
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Extraído del RUT')).toBeInTheDocument();
  });

  it('labels the source banner as manual entry when typed by hand', () => {
    render(
      <RutReviewStep
        draft={makeDraft()}
        isManual
        dvStatus="unknown"
        onFieldChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        'Escriba los datos tal como aparecen en el RUT de la empresa.',
      ),
    ).toBeInTheDocument();
  });

  it('reports every field edit with its field key', async () => {
    const user = userEvent.setup();
    const onFieldChange = vi.fn();
    render(
      <RutReviewStep
        draft={makeDraft()}
        isManual={false}
        dvStatus="valid"
        onFieldChange={onFieldChange}
      />,
    );

    await user.type(screen.getByLabelText('Razón social'), 'X');
    await user.type(screen.getByLabelText('DV'), '8');
    await user.type(screen.getByLabelText('CIIU'), '1');
    await user.type(screen.getByLabelText('Código de municipio'), '2');

    expect(onFieldChange).toHaveBeenCalledWith(
      'name',
      'FARMACIA LOS ANDES S.A.S.X',
    );
    expect(onFieldChange).toHaveBeenCalledWith('dv', '88');
    expect(onFieldChange).toHaveBeenCalledWith('ciiu', '47731');
    expect(onFieldChange).toHaveBeenCalledWith('municipioCode', '050012');
  });
});