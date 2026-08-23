/**
 * Component tests for CompanySetupWizard — the four-view onboarding flow
 * (upload → review → resolution → summary) plus the success view.
 *
 * The pos-local hook boundary is mocked: parsing/submit behavior is driven
 * by the mock contract, matching how the real hook behaves.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompanySetupWizard } from './company-setup-wizard';
import { navigateToHome } from '@/store/slices/ui-slice';
import type { CompanyDraft, RutParseResult } from '@/hooks/use-company-setup';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseCompanySetup = vi.hoisted(() => vi.fn());
const mockUploadRutFile = vi.hoisted(() => vi.fn());
const mockSubmitCompany = vi.hoisted(() => vi.fn());
const mockDispatch = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-company-setup', () => ({
  useCompanySetup: mockUseCompanySetup,
}));

vi.mock('@/store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: () => undefined,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeRutDraft = (): CompanyDraft => ({
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
});

const setupHookMock = (overrides: Record<string, unknown> = {}): void => {
  mockUseCompanySetup.mockReturnValue({
    status: 'needs-setup',
    draft: null,
    parsedFromRut: null,
    isResolving: false,
    uploadRutFile: mockUploadRutFile,
    submitCompany: mockSubmitCompany,
    reset: vi.fn(),
    ...overrides,
  });
};

const makePdfFile = (): File =>
  new File(['%PDF-1.7 fake'], 'rut.pdf', { type: 'application/pdf' });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CompanySetupWizard', () => {
  beforeEach(() => {
    mockUseCompanySetup.mockReset();
    mockUploadRutFile.mockReset();
    mockSubmitCompany.mockReset();
    mockDispatch.mockReset();
    setupHookMock();
  });

  it('starts on the RUT upload step with the step indicator', () => {
    render(<CompanySetupWizard />);

    expect(
      screen.getByRole('heading', {
        name: 'Configura tu empresa para facturar',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Paso 1 de 3')).toBeInTheDocument();
    expect(screen.getByLabelText('Archivo RUT (PDF)')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Ingresar datos manualmente' }),
    ).toBeInTheDocument();
  });

  it('moves to the review step with the parsed draft after a successful upload', async () => {
    const user = userEvent.setup();
    mockUploadRutFile.mockResolvedValue({
      ok: true,
      draft: makeRutDraft(),
    } satisfies RutParseResult);
    render(<CompanySetupWizard />);

    await user.upload(screen.getByLabelText('Archivo RUT (PDF)'), makePdfFile());

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Revise los datos extraídos' }),
      ).toBeInTheDocument();
    });
    expect(screen.getByLabelText('NIT (DV)')).toHaveValue('900123456');
    expect(screen.getByText('DV válido')).toBeInTheDocument();
    expect(mockUploadRutFile).toHaveBeenCalledTimes(1);
  });

  it('stays on the upload step and surfaces the parse error when the RUT is unparseable', async () => {
    const user = userEvent.setup();
    mockUploadRutFile.mockResolvedValue({
      ok: false,
      errorCode: 'UNPARSEABLE',
    } satisfies RutParseResult);
    render(<CompanySetupWizard />);

    await user.upload(screen.getByLabelText('Archivo RUT (PDF)'), makePdfFile());

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /no es un RUT legible o está dañado/i,
      );
    });
    expect(screen.getByText('Paso 1 de 3')).toBeInTheDocument();
  });

  it('surfaces the NIT-DV mismatch error from a parsed RUT', async () => {
    const user = userEvent.setup();
    mockUploadRutFile.mockResolvedValue({
      ok: false,
      errorCode: 'INVALID_NIT_DV',
    } satisfies RutParseResult);
    render(<CompanySetupWizard />);

    await user.upload(screen.getByLabelText('Archivo RUT (PDF)'), makePdfFile());

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /dígito de verificación incorrecto/i,
      );
    });
  });

  it('opens manual entry with an empty draft and an unverified DV badge', async () => {
    const user = userEvent.setup();
    render(<CompanySetupWizard />);

    await user.click(
      screen.getByRole('button', { name: 'Ingresar datos manualmente' }),
    );

    expect(
      screen.getByRole('heading', { name: 'Datos de la empresa' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('NIT (DV)')).toHaveValue('');
    expect(screen.getByText('DV sin validar')).toBeInTheDocument();
  });

  it('walks the full flow and submits the assembled draft on success', async () => {
    const user = userEvent.setup();
    mockSubmitCompany.mockResolvedValue(undefined);
    render(<CompanySetupWizard />);

    // 1. Upload step → manual entry
    await user.click(
      screen.getByRole('button', { name: 'Ingresar datos manualmente' }),
    );

    // 2. Review step — fill identity data
    await user.type(screen.getByLabelText('Razón social'), 'FARMACIA ANDINA S.A.S.');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    // 3. Resolution step — fill the DIAN resolution
    expect(screen.getByText('Paso 3 de 3')).toBeInTheDocument();
    await user.type(
      screen.getByLabelText('Número de resolución'),
      '18760000001234',
    );
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    // 4. Summary — review and submit
    expect(
      screen.getByRole('heading', { name: 'Resumen y guardado' }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Guardar datos de la empresa' }),
    );

    await waitFor(() => {
      expect(mockSubmitCompany).toHaveBeenCalledTimes(1);
    });
    const submitted = mockSubmitCompany.mock.calls[0][0] as CompanyDraft;
    expect(submitted.name).toBe('FARMACIA ANDINA S.A.S.');
    expect(submitted.resolutionNumber).toBe('18760000001234');

    // 5. Done — success view and navigation home
    await waitFor(() => {
      expect(
        screen.getByText('¡Listo! Empresa configurada'),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Continuar al sistema' }));

    expect(mockDispatch).toHaveBeenCalledWith(navigateToHome());
  });

  it('shows a submit error and stays on the summary when the server rejects', async () => {
    const user = userEvent.setup();
    mockSubmitCompany.mockRejectedValue(new Error('rejected'));
    render(<CompanySetupWizard />);

    await user.click(
      screen.getByRole('button', { name: 'Ingresar datos manualmente' }),
    );
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    await user.click(
      screen.getByRole('button', { name: 'Guardar datos de la empresa' }),
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /No se pudieron guardar los datos/,
      );
    });
    expect(
      screen.getByRole('heading', { name: 'Resumen y guardado' }),
    ).toBeInTheDocument();
  });

  it('navigates back through the steps', async () => {
    const user = userEvent.setup();
    render(<CompanySetupWizard />);

    await user.click(
      screen.getByRole('button', { name: 'Ingresar datos manualmente' }),
    );
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Volver' }));

    expect(
      screen.getByRole('heading', { name: 'Datos de la empresa' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Volver' }));

    expect(screen.getByText('Paso 1 de 3')).toBeInTheDocument();
  });
});