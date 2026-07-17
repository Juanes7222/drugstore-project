/**
 * UserPreferencesSection — local user preferences controls.
 *
 * Theme, language, date format, time format, sound, receipt font size,
 * keyboard layout selectors.
 */
import { type FC, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useUserPreferences } from '../../../domain/config/use-user-preferences';
import type {
  UserTheme,
  DateFormat,
  TimeFormat,
  Language,
  KeyboardLayout,
} from '../../../domain/config';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const THEME_OPTIONS: Array<{ value: UserTheme; label: string }> = [
  { value: 'LIGHT', label: 'Claro' },
  { value: 'DARK', label: 'Oscuro' },
  { value: 'SYSTEM', label: 'Sistema' },
];

const LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: 'es', label: 'Espanol' },
  { value: 'en', label: 'English' },
];

const DATE_FORMAT_OPTIONS: Array<{ value: DateFormat; label: string }> = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
];

const TIME_FORMAT_OPTIONS: Array<{ value: TimeFormat; label: string }> = [
  { value: '24H', label: '24 horas' },
  { value: '12H', label: '12 horas (AM/PM)' },
];

const KEYBOARD_OPTIONS: Array<{ value: KeyboardLayout; label: string }> = [
  { value: 'STANDARD', label: 'Estandar' },
  { value: 'COMPACT', label: 'Compacto' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface UserPreferencesSectionProps {
  /** Label override for the section heading. */
  title?: string;
}

export const UserPreferencesSection: FC<UserPreferencesSectionProps> = ({
  title,
}) => {
  const { t } = useTranslation();
  const {
    theme,
    language,
    dateFormat,
    timeFormat,
    soundEnabled,
    receiptFontSize,
    keyboardLayout,
    setTheme,
    setLanguage,
    setDateFormat,
    setTimeFormat,
    setSoundEnabled,
    setReceiptFontSize,
    setKeyboardLayout,
  } = useUserPreferences();

  const handleFontSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setReceiptFontSize(parseInt(e.target.value, 10));
    },
    [setReceiptFontSize],
  );

  return (
    <div className="space-y-6">
      <h3 className="text-base font-semibold text-ink dark:text-gray-100">
        {title ?? t('config.tabs.user_preferences')}
      </h3>

      <div className="space-y-4">
        {/* Theme */}
        <SelectField
          label="Tema"
          value={theme}
          options={THEME_OPTIONS}
          onChange={(v) => setTheme(v as UserTheme)}
        />

        {/* Language */}
        <SelectField
          label="Idioma"
          value={language}
          options={LANGUAGE_OPTIONS}
          onChange={(v) => setLanguage(v as Language)}
        />

        {/* Date format */}
        <SelectField
          label="Formato de fecha"
          value={dateFormat}
          options={DATE_FORMAT_OPTIONS}
          onChange={(v) => setDateFormat(v as DateFormat)}
        />

        {/* Time format */}
        <SelectField
          label="Formato de hora"
          value={timeFormat}
          options={TIME_FORMAT_OPTIONS}
          onChange={(v) => setTimeFormat(v as TimeFormat)}
        />

        {/* Sound toggle */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-panel px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
          <span className="text-sm font-medium text-ink dark:text-gray-100">
            Sonido
          </span>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => setSoundEnabled(e.target.checked)}
              className="peer sr-only"
              aria-label="Sonido"
            />
            <div className="h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-panel after:transition-all peer-checked:bg-pharma peer-checked:after:translate-x-full peer-focus:outline-2 peer-focus:outline-blue-600 dark:bg-gray-600 dark:after:bg-gray-300" />
          </label>
        </div>

        {/* Receipt font size */}
        <div className="rounded-lg border border-border bg-panel px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink dark:text-gray-100">
              Tamano de letra del recibo
            </span>
            <span className="text-sm text-ink-muted dark:text-gray-400">
              {receiptFontSize}pt
            </span>
          </div>
          <input
            type="range"
            min={8}
            max={20}
            step={1}
            value={receiptFontSize}
            onChange={handleFontSizeChange}
            className="mt-2 w-full cursor-pointer accent-blue-600"
            aria-label="Tamano de letra del recibo"
          />
          <div className="mt-1 flex justify-between text-xs text-ink-muted">
            <span>8pt</span>
            <span>20pt</span>
          </div>
        </div>

        {/* Keyboard layout */}
        <SelectField
          label="Distribucion del teclado"
          value={keyboardLayout}
          options={KEYBOARD_OPTIONS}
          onChange={(v) => setKeyboardLayout(v as KeyboardLayout)}
        />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helper small component for labelled selects
// ---------------------------------------------------------------------------

interface SelectFieldProps {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

const SelectField: FC<SelectFieldProps> = ({ label, value, options, onChange }) => (
  <div className="flex items-center justify-between rounded-lg border border-border bg-panel px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
    <span className="text-sm font-medium text-ink dark:text-gray-100">
      {label}
    </span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="ml-4 rounded-lg border border-border px-3 py-1.5 text-sm focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
      aria-label={label}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);
