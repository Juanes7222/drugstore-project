/**
 * ExportMenu — dropdown button exposing the four export formats (Excel,
 * CSV, PDF, print) for a listado screen's current dataset.
 *
 * Presentational only: the parent owns the export pipeline (useDataExport)
 * and receives the chosen format via onExport.
 */
import { type FC, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ChevronDownIcon,
  DownloadIcon,
  FileDownIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  PrinterIcon,
  RefreshCwIcon,
} from './icons';
import type { ExportFormat } from '../../../common/export';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ExportMenuProps {
  /** Called with the chosen format; the parent runs the export pipeline. */
  onExport: (format: ExportFormat) => void;
  /** Disables the trigger and shows a spinner while an export runs. */
  exporting?: boolean;
  /** Extra classes for the wrapper. */
  className?: string;
}

const FORMAT_OPTIONS: ReadonlyArray<{
  format: ExportFormat;
  labelKey: string;
  labelFallback: string;
  icon: FC<{ className?: string }>;
}> = [
  {
    format: 'excel',
    labelKey: 'export.menu.excel',
    labelFallback: 'Excel (.xlsx)',
    icon: FileSpreadsheetIcon,
  },
  {
    format: 'csv',
    labelKey: 'export.menu.csv',
    labelFallback: 'CSV',
    icon: FileTextIcon,
  },
  {
    format: 'pdf',
    labelKey: 'export.menu.pdf',
    labelFallback: 'PDF',
    icon: FileDownIcon,
  },
  {
    format: 'print',
    labelKey: 'export.menu.print',
    labelFallback: 'Imprimir',
    icon: PrinterIcon,
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ExportMenu: FC<ExportMenuProps> = ({
  onExport,
  exporting = false,
  className = '',
}) => {
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const menuLabel = t('export.menu.label', { defaultValue: 'Exportar' });

  // Close on outside click; close + refocus the trigger on Escape.
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = useCallback(
    (format: ExportFormat) => {
      setIsOpen(false);
      triggerRef.current?.focus();
      onExport(format);
    },
    [onExport],
  );

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={exporting}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
        className="pos-button pos-button-secondary inline-flex items-center gap-1.5 text-body-sm"
      >
        {exporting ? (
          <RefreshCwIcon className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <DownloadIcon className="size-4" aria-hidden="true" />
        )}
        <span className="hidden sm:inline">{menuLabel}</span>
        <ChevronDownIcon
          className={`size-3.5 transition-transform duration-100 ${
            isOpen ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            id={menuId}
            role="menu"
            aria-label={menuLabel}
            initial={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            className="absolute right-0 top-full z-50 mt-1 min-w-44 overflow-hidden rounded-sm border"
            style={{
              backgroundColor: 'var(--color-panel)',
              borderColor:
                'color-mix(in srgb, var(--color-ink) 12%, transparent)',
              boxShadow:
                '0 4px 16px color-mix(in srgb, var(--color-ink) 12%, transparent)',
            }}
          >
            {FORMAT_OPTIONS.map((option) => {
              const OptionIcon = option.icon;
              return (
                <button
                  key={option.format}
                  type="button"
                  role="menuitem"
                  onClick={() => handleSelect(option.format)}
                  disabled={exporting}
                  className="flex w-full items-center gap-2 px-3 py-2 text-body-sm font-medium transition-colors duration-75 hover:bg-[color-mix(in_srgb,var(--color-pharma)_8%,transparent)]"
                  style={{ color: 'var(--color-ink)' }}
                >
                  <OptionIcon className="size-4" aria-hidden="true" />
                  {t(option.labelKey, {
                    defaultValue: option.labelFallback,
                  })}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};