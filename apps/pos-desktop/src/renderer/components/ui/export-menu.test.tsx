/**
 * Component tests for ExportMenu.
 *
 * useTranslation is mocked so the rendered labels are the component's own
 * defaultValue fallbacks, and the t spy asserts the exact i18n keys used.
 * useReducedMotion is forced true so the menu mounts/unmounts synchronously
 * instead of waiting on exit animations.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportMenu } from './export-menu';
import { ExportFormat } from '../../../common/export';
import es from '../../i18n/locales/es.json';

const { tMock } = vi.hoisted(() => ({
  tMock: vi.fn(
    (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tMock }),
}));

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return { ...actual, useReducedMotion: () => true };
});

const FORMAT_CASES = [
  { format: ExportFormat.EXCEL, label: es.export.menu.excel },
  { format: ExportFormat.CSV, label: es.export.menu.csv },
  { format: ExportFormat.PDF, label: es.export.menu.pdf },
  { format: ExportFormat.PRINT, label: es.export.menu.print },
] as const;

describe('ExportMenu', () => {
  beforeEach(() => {
    tMock.mockClear();
  });

  it('renders the trigger with the translated label', () => {
    render(<ExportMenu onExport={vi.fn()} />);

    const trigger = screen.getByRole('button', { name: es.export.menu.label });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps the menu closed by default', () => {
    render(<ExportMenu onExport={vi.fn()} />);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('opens the menu on click showing all four formats', async () => {
    render(<ExportMenu onExport={vi.fn()} />);

    await userEvent.click(
      screen.getByRole('button', { name: es.export.menu.label }),
    );

    const trigger = screen.getByRole('button', { name: es.export.menu.label });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeVisible();
    expect(
      screen.getByRole('menuitem', { name: es.export.menu.excel }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: es.export.menu.csv }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: es.export.menu.pdf }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: es.export.menu.print }),
    ).toBeInTheDocument();
  });

  it.each(FORMAT_CASES)(
    'calls onExport with $format and closes the menu when selected',
    async ({ format, label }) => {
      const onExport = vi.fn();
      render(<ExportMenu onExport={onExport} />);

      await userEvent.click(
        screen.getByRole('button', { name: es.export.menu.label }),
      );
      await userEvent.click(screen.getByRole('menuitem', { name: label }));

      expect(onExport).toHaveBeenCalledTimes(1);
      expect(onExport).toHaveBeenCalledWith(format);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: es.export.menu.label }),
      ).toHaveAttribute('aria-expanded', 'false');
    },
  );

  it('disables the trigger and prevents opening while exporting', async () => {
    render(<ExportMenu onExport={vi.fn()} exporting />);

    const trigger = screen.getByRole('button', { name: es.export.menu.label });
    expect(trigger).toBeDisabled();
    expect(trigger.querySelector('.animate-spin')).toBeInTheDocument();

    await userEvent.click(trigger);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes the menu and refocuses the trigger on Escape', async () => {
    render(<ExportMenu onExport={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: es.export.menu.label });
    await userEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes the menu on an outside pointerdown', async () => {
    render(<ExportMenu onExport={vi.fn()} />);
    await userEvent.click(
      screen.getByRole('button', { name: es.export.menu.label }),
    );
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await userEvent.click(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('uses the export i18n keys with fallback defaults', async () => {
    render(<ExportMenu onExport={vi.fn()} />);

    await userEvent.click(
      screen.getByRole('button', { name: es.export.menu.label }),
    );

    expect(tMock).toHaveBeenCalledWith('export.menu.label', {
      defaultValue: 'Exportar',
    });
    expect(tMock).toHaveBeenCalledWith('export.menu.excel', {
      defaultValue: 'Excel (.xlsx)',
    });
    expect(tMock).toHaveBeenCalledWith('export.menu.csv', {
      defaultValue: 'CSV',
    });
    expect(tMock).toHaveBeenCalledWith('export.menu.pdf', {
      defaultValue: 'PDF',
    });
    expect(tMock).toHaveBeenCalledWith('export.menu.print', {
      defaultValue: 'Imprimir',
    });
  });
});