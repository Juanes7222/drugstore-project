/**
 * UserPreferencesSection — local user preferences controls.
 *
 * Theme, language, date format, time format, sound, receipt font size,
 * keyboard layout selectors.
 */
import { type FC, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Sun, Globe, CalendarDays, Clock, Volume2, Ruler, Keyboard, type LucideIcon } from 'lucide-react';
import { useUserPreferences } from '../../../domain/config/use-user-preferences';
import type {
  UserTheme,
  DateFormat,
  TimeFormat,
  Language,
  KeyboardLayout,
} from '../../../domain/config';

// ---------------------------------------------------------------------------
// Options with icons
// ---------------------------------------------------------------------------

interface Option<T> {
  value: T;
  label: string;
}

const THEME_OPTIONS: Option<UserTheme>[] = [
  { value: 'LIGHT', label: 'Claro' },
  { value: 'DARK', label: 'Oscuro' },
  { value: 'SYSTEM', label: 'Sistema' },
];

const LANGUAGE_OPTIONS: Option<Language>[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
];

const DATE_FORMAT_OPTIONS: Option<DateFormat>[] = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
];

const TIME_FORMAT_OPTIONS: Option<TimeFormat>[] = [
  { value: '24H', label: '24 horas' },
  { value: '12H', label: '12 horas (AM/PM)' },
];

const KEYBOARD_OPTIONS: Option<KeyboardLayout>[] = [
  { value: 'STANDARD', label: 'Estándar' },
  { value: 'COMPACT', label: 'Compacto' },
];

// ---------------------------------------------------------------------------
// Preference row layout — consistent card with icon, label, and control
// ---------------------------------------------------------------------------

interface PreferenceRowProps {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}

const PreferenceRow: FC<PreferenceRowProps> = ({ icon: Icon, label, children }) => (
  <div className="flex items-center justify-between rounded-sm border border-border bg-panel px-pos-md py-pos-sm transition-colors hover:bg-surface-variant">
    <div className="flex items-center gap-pos-md">
      <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-pharma/10 text-pharma">
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <span className="text-body-sm font-medium text-ink">
        {label}
      </span>
    </div>
    {children}
  </div>
);

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
      <h3 className="text-ui font-semibold text-ink">
        {title ?? t('config.tabs.user_preferences')}
      </h3>

      <div className="space-y-pos-xs">
        {/* Theme */}
        <PreferenceRow icon={Sun} label="Tema">
          <SelectControl
            value={theme}
            options={THEME_OPTIONS}
            onChange={(v) => setTheme(v as UserTheme)}
          />
        </PreferenceRow>

        {/* Language */}
        <PreferenceRow icon={Globe} label="Idioma">
          <SelectControl
            value={language}
            options={LANGUAGE_OPTIONS}
            onChange={(v) => setLanguage(v as Language)}
          />
        </PreferenceRow>

        {/* Date format */}
        <PreferenceRow icon={CalendarDays} label="Formato de fecha">
          <SelectControl
            value={dateFormat}
            options={DATE_FORMAT_OPTIONS}
            onChange={(v) => setDateFormat(v as DateFormat)}
          />
        </PreferenceRow>

        {/* Time format */}
        <PreferenceRow icon={Clock} label="Formato de hora">
          <SelectControl
            value={timeFormat}
            options={TIME_FORMAT_OPTIONS}
            onChange={(v) => setTimeFormat(v as TimeFormat)}
          />
        </PreferenceRow>

        {/* Sound toggle */}
        <PreferenceRow icon={Volume2} label="Sonido">
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => setSoundEnabled(e.target.checked)}
              className="peer sr-only"
              aria-label="Sonido"
            />
            <div className="h-6 w-11 rounded-full bg-surface-variant after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-panel after:transition-all peer-checked:bg-pharma peer-checked:after:translate-x-full peer-focus:outline-2 peer-focus:outline-pharma" />
          </label>
        </PreferenceRow>

        {/* Receipt font size */}
        <div className="rounded-sm border border-border bg-panel px-pos-md py-pos-sm transition-colors hover:bg-surface-variant">
          <div className="flex items-center gap-pos-md">
            <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-pharma/10 text-pharma">
              <Ruler size={16} strokeWidth={1.5} aria-hidden="true" />
            </div>
            <span className="text-body-sm font-medium text-ink">
              Tamaño de letra del recibo
            </span>
          </div>
          <div className="ml-11 mt-pos-sm">
            <div className="flex items-center justify-between">
              <span className="text-caption text-ink-muted">8pt</span>
              <motion.span
                key={receiptFontSize}
                className="text-body-sm font-data text-pharma"
                initial={{ opacity: 0.5, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
              >
                {receiptFontSize}pt
              </motion.span>
              <span className="text-caption text-ink-muted">20pt</span>
            </div>
            <input
              type="range"
              min={8}
              max={20}
              step={1}
              value={receiptFontSize}
              onChange={handleFontSizeChange}
              className="mt-pos-xs w-full cursor-pointer accent-pharma"
              aria-label="Tamaño de letra del recibo"
            />
          </div>
        </div>

        {/* Keyboard layout */}
        <PreferenceRow icon={Keyboard} label="Distribución del teclado">
          <SelectControl
            value={keyboardLayout}
            options={KEYBOARD_OPTIONS}
            onChange={(v) => setKeyboardLayout(v as KeyboardLayout)}
          />
        </PreferenceRow>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SelectControl — compact styled select using pos-input
// ---------------------------------------------------------------------------

interface SelectControlProps<T extends string> {
  value: string;
  options: Option<T>[];
  onChange: (value: string) => void;
}

function SelectControl<T extends string>({
  value,
  options,
  onChange,
}: SelectControlProps<T>): React.ReactElement {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="pos-input ml-pos-md"
      aria-label={options.find((o) => o.value === value)?.label}
    >
      {options.map((opt) => (
        <option key={opt.value as string} value={opt.value as string}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
