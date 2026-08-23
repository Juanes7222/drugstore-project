/**
 * Component tests for RutUploadStep — dropzone, parsing feedback, parse
 * error surfaces, retry and the manual-entry fallback.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RutUploadStep, type RutUploadErrorCode } from './rut-upload-step';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeFile = (): File =>
  new File(['%PDF-1.7 fake'], 'rut.pdf', { type: 'application/pdf' });

const renderStep = (props: Partial<Parameters<typeof RutUploadStep>[0]> = {}) => {
  const onFileSelected = vi.fn();
  const onManualEntry = vi.fn();
  const onRetry = vi.fn();

  render(
    <RutUploadStep
      isParsing={false}
      parseError={null}
      onFileSelected={onFileSelected}
      onManualEntry={onManualEntry}
      onRetry={onRetry}
      {...props}
    />,
  );

  return { onFileSelected, onManualEntry, onRetry };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RutUploadStep', () => {
  it('renders the dropzone with a labeled file input', () => {
    renderStep();

    expect(
      screen.getByLabelText('Archivo RUT (PDF)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Arrastre el RUT (PDF) aquí o haga clic para buscarlo'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/PDF · extraemos NIT, razón social/),
    ).toBeInTheDocument();
  });

  it('passes the selected file up when the user picks one', async () => {
    const user = userEvent.setup();
    const { onFileSelected } = renderStep();

    await user.upload(screen.getByLabelText('Archivo RUT (PDF)'), makeFile());

    expect(onFileSelected).toHaveBeenCalledTimes(1);
    expect(onFileSelected.mock.calls[0][0]).toBeInstanceOf(File);
  });

  it('passes the dropped file up when a file is dropped on the dropzone', () => {
    const { onFileSelected } = renderStep();
    const dropzone = screen
      .getByText('Arrastre el RUT (PDF) aquí o haga clic para buscarlo')
      .closest('label');

    fireEvent.drop(dropzone as HTMLLabelElement, {
      dataTransfer: { files: [makeFile()] },
    });

    expect(onFileSelected).toHaveBeenCalledTimes(1);
    expect(onFileSelected.mock.calls[0][0]).toBeInstanceOf(File);
  });

  it('replaces the dropzone with parsing feedback while reading the PDF', () => {
    renderStep({ isParsing: true });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Leyendo el RUT...');
    expect(status).toHaveTextContent('Se extraen los datos del documento');
    expect(screen.queryByLabelText('Archivo RUT (PDF)')).not.toBeInTheDocument();
  });

  it.each(['UNPARSEABLE', 'INVALID_NIT_DV'] as RutUploadErrorCode[])(
    'surfaces %s as a visible error with a retry action',
    (code) => {
      const { onRetry } = renderStep({ parseError: code });

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('No se pudo leer el RUT');

      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    },
  );

  it('explains the unparseable-file error', () => {
    renderStep({ parseError: 'UNPARSEABLE' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      /no es un RUT legible o está dañado/i,
    );
  });

  it('explains the NIT-DV mismatch error', () => {
    renderStep({ parseError: 'INVALID_NIT_DV' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      /dígito de verificación incorrecto/i,
    );
  });

  it('shows no error surface when there is no parse error', () => {
    renderStep();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens the manual-entry fallback', async () => {
    const user = userEvent.setup();
    const { onManualEntry } = renderStep();

    await user.click(
      screen.getByRole('button', { name: 'Ingresar datos manualmente' }),
    );

    expect(onManualEntry).toHaveBeenCalledTimes(1);
  });
});