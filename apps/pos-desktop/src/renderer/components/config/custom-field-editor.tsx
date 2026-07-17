/**
 * CustomFieldEditor — modal for adding/editing custom company fields or
 * strictness toggles.
 *
 * Type-dependent form fields with inline validation.
 */
import { type FC, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'motion/react';
import type {
  CustomCompanyField,
  CustomStrictnessToggle,
  CustomFieldType,
  CustomToggleType,
  CustomToggleAppliesTo,
} from '../../../domain/config';

// ---------------------------------------------------------------------------
// Mode — which entity we are editing
// ---------------------------------------------------------------------------

export type CustomFieldEditorMode =
  | { kind: 'field'; field?: CustomCompanyField }
  | { kind: 'toggle'; toggle?: CustomStrictnessToggle };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CustomFieldEditorProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Close handler. */
  onOpenChange: (open: boolean) => void;
  /** What we are editing. */
  mode: CustomFieldEditorMode;
  /** Save handler — receives the completed entity. */
  onSave: (data: CustomCompanyField | CustomStrictnessToggle) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CustomFieldEditor: FC<CustomFieldEditorProps> = ({
  open,
  onOpenChange,
  mode,
  onSave,
}) => {
  const { t } = useTranslation();
  const isEditing = mode.kind === 'field'
    ? mode.field !== undefined
    : mode.toggle !== undefined;

  // ---- Field mode state ----
  const [fieldName, setFieldName] = useState(
    mode.kind === 'field' ? mode.field?.name ?? '' : '',
  );
  const [fieldKey, setFieldKey] = useState(
    mode.kind === 'field' ? mode.field?.key ?? '' : '',
  );
  const [fieldType, setFieldType] = useState<CustomFieldType>(
    mode.kind === 'field' ? mode.field?.type ?? 'TEXT' : 'TEXT',
  );
  const [fieldShowOnInvoice, setFieldShowOnInvoice] = useState(
    mode.kind === 'field' ? mode.field?.showOnInvoice ?? true : true,
  );
  const [fieldShowOnReport, setFieldShowOnReport] = useState(
    mode.kind === 'field' ? mode.field?.showOnReport ?? true : true,
  );

  // ---- Toggle mode state ----
  const [toggleName, setToggleName] = useState(
    mode.kind === 'toggle' ? mode.toggle?.name ?? '' : '',
  );
  const [toggleKey, setToggleKey] = useState(
    mode.kind === 'toggle' ? mode.toggle?.key ?? '' : '',
  );
  const [toggleDescription, setToggleDescription] = useState(
    mode.kind === 'toggle' ? mode.toggle?.description ?? '' : '',
  );
  const [toggleType, setToggleType] = useState<CustomToggleType>(
    mode.kind === 'toggle' ? mode.toggle?.type ?? 'BOOLEAN' : 'BOOLEAN',
  );
  const [toggleAppliesTo, setToggleAppliesTo] = useState<CustomToggleAppliesTo>(
    mode.kind === 'toggle' ? mode.toggle?.appliesTo ?? 'ALL' : 'ALL',
  );

  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback((): void => {
    if (mode.kind === 'field') {
      setFieldName(mode.field?.name ?? '');
      setFieldKey(mode.field?.key ?? '');
      setFieldType(mode.field?.type ?? 'TEXT');
      setFieldShowOnInvoice(mode.field?.showOnInvoice ?? true);
      setFieldShowOnReport(mode.field?.showOnReport ?? true);
    } else {
      setToggleName(mode.toggle?.name ?? '');
      setToggleKey(mode.toggle?.key ?? '');
      setToggleDescription(mode.toggle?.description ?? '');
      setToggleType(mode.toggle?.type ?? 'BOOLEAN');
      setToggleAppliesTo(mode.toggle?.appliesTo ?? 'ALL');
    }
    setError(null);
  }, [mode]);

  const handleSave = useCallback((): void => {
    setError(null);

    if (mode.kind === 'field') {
      if (!fieldName.trim()) {
        setError(t('config.validation.required'));
        return;
      }
      if (!fieldKey.trim()) {
        setError(t('config.validation.required'));
        return;
      }

      const field: CustomCompanyField = {
        id: mode.field?.id ?? crypto.randomUUID(),
        name: fieldName.trim(),
        key: fieldKey.trim(),
        type: fieldType,
        value: mode.field?.value ?? '',
        required: mode.field?.required ?? false,
        showOnInvoice: fieldShowOnInvoice,
        showOnReport: fieldShowOnReport,
        order: mode.field?.order ?? 0,
      };
      onSave(field);
      onOpenChange(false);
    } else {
      if (!toggleName.trim()) {
        setError(t('config.validation.required'));
        return;
      }
      if (!toggleKey.trim()) {
        setError(t('config.validation.required'));
        return;
      }

      const toggle: CustomStrictnessToggle = {
        id: mode.toggle?.id ?? crypto.randomUUID(),
        name: toggleName.trim(),
        key: toggleKey.trim(),
        description: toggleDescription.trim(),
        type: toggleType,
        defaultValue: mode.toggle?.defaultValue ?? false,
        appliesTo: toggleAppliesTo,
        isAdvisory: mode.toggle?.isAdvisory ?? false,
      };
      onSave(toggle);
      onOpenChange(false);
    }
  }, [
    mode,
    fieldName,
    fieldKey,
    fieldType,
    fieldShowOnInvoice,
    fieldShowOnReport,
    toggleName,
    toggleKey,
    toggleDescription,
    toggleType,
    toggleAppliesTo,
    onSave,
    onOpenChange,
    t,
  ]);

  const handleOpenChangeWrapper = useCallback(
    (open: boolean) => {
      if (!open) {
        resetForm();
      }
      onOpenChange(open);
    },
    [onOpenChange, resetForm],
  );

  const isFieldMode = mode.kind === 'field';

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChangeWrapper}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-40 bg-black/50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-panel p-6 shadow-xl dark:bg-gray-800"
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.2 }}
              >
                <Dialog.Title className="text-lg font-semibold text-ink dark:text-gray-100">
                  {isEditing
                    ? isFieldMode
                      ? t('config.custom_fields.edit')
                      : t('config.custom_toggles.add')
                    : isFieldMode
                      ? t('config.custom_fields.add')
                      : t('config.custom_toggles.add')}
                </Dialog.Title>

                <div className="mt-4 space-y-4">
                  {/* Name field (shared) */}
                  <label className="block">
                    <span className="text-sm font-medium text-ink-muted dark:text-gray-300">
                      {isFieldMode
                        ? t('config.custom_fields.name')
                        : t('config.custom_toggles.description')}
                    </span>
                    <input
                      type="text"
                      value={isFieldMode ? fieldName : toggleName}
                      onChange={(e) =>
                        isFieldMode
                          ? setFieldName(e.target.value)
                          : setToggleName(e.target.value)
                      }
                      className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    />
                  </label>

                  {/* Key field (shared) */}
                  <label className="block">
                    <span className="text-sm font-medium text-ink-muted dark:text-gray-300">
                      {t('config.custom_fields.key')}
                    </span>
                    <input
                      type="text"
                      value={isFieldMode ? fieldKey : toggleKey}
                      onChange={(e) =>
                        isFieldMode
                          ? setFieldKey(e.target.value)
                          : setToggleKey(e.target.value)
                      }
                      className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    />
                  </label>

                  {/* Type selector (shared) */}
                  <label className="block">
                    <span className="text-sm font-medium text-ink-muted dark:text-gray-300">
                      {t('config.custom_fields.type')}
                    </span>
                    <select
                      value={isFieldMode ? fieldType : toggleType}
                      onChange={(e) =>
                        isFieldMode
                          ? setFieldType(e.target.value as CustomFieldType)
                          : setToggleType(e.target.value as CustomToggleType)
                      }
                      className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    >
                      {isFieldMode
                        ? (['TEXT', 'NUMBER', 'DATE', 'URL', 'EMAIL'] as const).map(
                            (type) => (
                              <option key={type} value={type}>
                                {t('config.custom_fields.' + type.toLowerCase())}
                              </option>
                            ),
                          )
                        : (['BOOLEAN', 'SELECT', 'AMOUNT'] as const).map((type) => (
                            <option key={type} value={type}>
                              {type.charAt(0) + type.slice(1).toLowerCase()}
                            </option>
                          ))}
                    </select>
                  </label>

                  {/* Field-specific: toggles */}
                  {isFieldMode ? (
                    <>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={fieldShowOnInvoice}
                          onChange={(e) => setFieldShowOnInvoice(e.target.checked)}
                          className="h-4 w-4 rounded border-border text-pharma focus:ring-pharma"
                        />
                        <span className="text-sm text-ink-muted dark:text-gray-300">
                          {t('config.custom_fields.show_on_invoice')}
                        </span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={fieldShowOnReport}
                          onChange={(e) => setFieldShowOnReport(e.target.checked)}
                          className="h-4 w-4 rounded border-border text-pharma focus:ring-pharma"
                        />
                        <span className="text-sm text-ink-muted dark:text-gray-300">
                          {t('config.custom_fields.show_on_report')}
                        </span>
                      </label>
                    </>
                  ) : (
                    <label className="block">
                      <span className="text-sm font-medium text-ink-muted dark:text-gray-300">
                        {t('config.custom_toggles.applies_to')}
                      </span>
                      <select
                        value={toggleAppliesTo}
                        onChange={(e) =>
                          setToggleAppliesTo(e.target.value as CustomToggleAppliesTo)
                        }
                        className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                      >
                        {(['SALE', 'RETURN', 'INVENTORY', 'CLIENT', 'ALL'] as const).map(
                          (a) => (
                            <option key={a} value={a}>
                              {a.charAt(0) + a.slice(1).toLowerCase()}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}
                </div>

                {/* Error */}
                {error && (
                  <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
                    {error}
                  </p>
                )}

                {/* Actions */}
                <div className="mt-6 flex justify-end gap-3">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-lg bg-surface-variant px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                    >
                      {t('common.cancel')}
                    </button>
                  </Dialog.Close>
                  <button
                    type="button"
                    onClick={handleSave}
                    className="rounded-lg bg-pharma px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pharma/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
};
