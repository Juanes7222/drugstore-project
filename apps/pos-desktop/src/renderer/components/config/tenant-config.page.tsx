/**
 * TenantConfigPage — main configuration page with tabs.
 *
 * Layout: sidebar with tab icons on left, content on right.
 * Top shows ActiveModeIndicator.
 * Tabs: Empresa, Fiscal, Operacion, Preferencias del sistema, Preferencias de usuario.
 */
import { type FC, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import {
  useTenantConfig,
  type CustomCompanyField,
  type CustomStrictnessToggle,
} from '../../../domain/config';
import { ActiveModeIndicator } from './active-mode-indicator';
import { StrictnessSection } from './strictness.section';
import { CustomFieldEditor } from './custom-field-editor';
import { FieldRequirementIndicator } from './field-requirement-indicator';
import { UserPreferencesSection } from './user-preferences.section';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabId = 'company' | 'fiscal' | 'operation' | 'preferences' | 'user-preferences';

interface TabDefinition {
  id: TabId;
  i18nKey: string;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
}

const TABS: TabDefinition[] = [
  {
    id: 'company',
    i18nKey: 'tabs.company',
    icon: (props) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    id: 'fiscal',
    i18nKey: 'tabs.fiscal',
    icon: (props) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    id: 'operation',
    i18nKey: 'tabs.operation',
    icon: (props) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    id: 'preferences',
    i18nKey: 'tabs.preferences',
    icon: (props) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
  },
  {
    id: 'user-preferences',
    i18nKey: 'tabs.user_preferences',
    icon: (props) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

// ---------------------------------------------------------------------------
// Tax regime options
// ---------------------------------------------------------------------------

const TAX_REGIMES: Array<{ value: string; labelKey: string }> = [
  { value: 'RESPONSABLE_IVA', labelKey: 'fiscal.tax_regime_responsable' },
  { value: 'NO_RESPONSABLE', labelKey: 'fiscal.tax_regime_no_responsable' },
  { value: 'SIMPLE', labelKey: 'fiscal.tax_regime_simple' },
  { value: 'EXENTO', labelKey: 'fiscal.tax_regime_exento' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface TenantConfigPageProps {
  /** If true, shows in read-only mode. */
  readOnly?: boolean;
}

export const TenantConfigPage: FC<TenantConfigPageProps> = ({
  readOnly = false,
}) => {
  const { t } = useTranslation();
  const {
    config,
    effectiveConfig,
    isLoading,
    error,
    update,
    addCustomField,
    updateCustomField,
    removeCustomField,
  } = useTenantConfig();

  const [activeTab, setActiveTab] = useState<TabId>('company');
  const [customFieldEditorOpen, setCustomFieldEditorOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomCompanyField | undefined>();

  // ---- Tab switching ----

  const handleTabChange = useCallback((tabId: TabId) => {
    setActiveTab(tabId);
  }, []);

  // ---- Custom field handlers ----

  const handleAddCustomField = useCallback(() => {
    setEditingField(undefined);
    setCustomFieldEditorOpen(true);
  }, []);

  const handleEditCustomField = useCallback((field: CustomCompanyField) => {
    setEditingField(field);
    setCustomFieldEditorOpen(true);
  }, []);

  const handleSaveCustomField = useCallback(
    async (data: CustomCompanyField | CustomStrictnessToggle) => {
      const field = data as CustomCompanyField;
      if (editingField) {
        await updateCustomField(field.id, field);
      } else {
        await addCustomField(field);
      }
    },
    [editingField, updateCustomField, addCustomField],
  );

  const handleRemoveCustomField = useCallback(
    async (fieldId: string) => {
      await removeCustomField(fieldId);
    },
    [removeCustomField],
  );

  // ---- Generic field change handler ----

  const handleFieldChange = useCallback(
    async (section: 'fiscal' | 'workflow', key: string, value: unknown) => {
      if (readOnly || !config) return;
      // Send the full section with the changed field — the server needs
      // the complete context for cross-field validation (e.g. strictness
      // clientRequired + clientRequiredThreshold).
      if (section === 'fiscal') {
        await update({ fiscal: { ...config.fiscal, [key]: value } });
      } else {
        await update({ workflow: { ...config.workflow, [key]: value } });
      }
    },
    [config, update, readOnly],
  );

  // ---- Render helpers ----

  const renderTabContent = (): React.ReactNode => {
    switch (activeTab) {
      case 'company':
        return renderCompanyTab();
      case 'fiscal':
        return renderFiscalTab();
      case 'operation':
        return renderOperationTab();
      case 'preferences':
        return renderPreferencesTab();
      case 'user-preferences':
        return renderUserPreferencesTab();
    }
  };

  // ---- Company tab ----

  const renderCompanyTab = (): React.ReactNode => (
    <div className="space-y-6">
      <h3 className="text-base font-semibold text-ink dark:text-gray-100">
        {t('config.fiscal.company_name')}
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label={t('config.fiscal.company_name')}
          value={config?.fiscal.companyName ?? ''}
          onChange={(v) => handleFieldChange('fiscal', 'companyName', v)}
          disabled={readOnly}
        />
        <TextField
          label={t('config.fiscal.nit')}
          value={config?.fiscal.nit ?? ''}
          onChange={(v) => handleFieldChange('fiscal', 'nit', v)}
          disabled={readOnly}
        />
        <TextField
          label={t('config.fiscal.address')}
          value={config?.fiscal.address ?? ''}
          onChange={(v) => handleFieldChange('fiscal', 'address', v)}
          disabled={readOnly}
          className="col-span-2"
        />
        <TextField
          label={t('config.fiscal.city')}
          value={config?.fiscal.city ?? ''}
          onChange={(v) => handleFieldChange('fiscal', 'city', v)}
          disabled={readOnly}
        />
        <TextField
          label={t('config.fiscal.phone')}
          value={config?.fiscal.phone ?? ''}
          onChange={(v) => handleFieldChange('fiscal', 'phone', v)}
          disabled={readOnly}
        />
        <TextField
          label={t('config.fiscal.email')}
          value={config?.fiscal.email ?? ''}
          onChange={(v) => handleFieldChange('fiscal', 'email', v)}
          disabled={readOnly}
          type="email"
        />
      </div>

      {/* Custom fields section */}
      <div className="border-t border-border pt-6 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink dark:text-gray-100">
            {t('config.custom_fields.title')}
          </h3>
          {!readOnly && (
            <button
              type="button"
              onClick={handleAddCustomField}
              className="inline-flex items-center gap-1 rounded-lg bg-pharma px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-pharma/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t('config.custom_fields.add')}
            </button>
          )}
        </div>

        {!effectiveConfig?.customCompanyFields ||
        effectiveConfig.customCompanyFields.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted dark:text-gray-400">
            {t('config.custom_fields.add')}
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {effectiveConfig.customCompanyFields.map((field) => (
              <div
                key={field.id}
                className="flex items-center justify-between rounded-lg border border-border bg-panel px-4 py-3 dark:border-gray-700 dark:bg-gray-800"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink dark:text-gray-100">
                      {field.name}
                    </span>
                    <span className="text-xs text-ink-muted">({field.key})</span>
                    <FieldRequirementIndicator
                      requirement={field.required ? 'REQUIRED' : 'OPTIONAL'}
                    />
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted dark:text-gray-400">
                    {t('config.custom_fields.' + (field.type.toLowerCase() as 'text' | 'number' | 'date' | 'url' | 'email'))}
                    {field.showOnInvoice && ` — ${t('config.custom_fields.show_on_invoice')}`}
                    {field.showOnReport && ` — ${t('config.custom_fields.show_on_report')}`}
                  </p>
                </div>
                {!readOnly && (
                  <div className="ml-4 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleEditCustomField(field)}
                      className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-variant hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma dark:hover:bg-gray-700"
                      aria-label={`${t('config.custom_fields.edit')} ${field.name}`}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomField(field.id)}
                      className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-error-container hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error dark:hover:bg-red-900/20"
                      aria-label={`${t('config.custom_fields.remove')} ${field.name}`}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ---- Fiscal tab ----

  const renderFiscalTab = (): React.ReactNode => (
    <div className="space-y-6">
      <h3 className="text-base font-semibold text-ink dark:text-gray-100">
        {t('config.tabs.fiscal')}
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <SelectField
          label={t('config.fiscal.tax_regime')}
          value={config?.fiscal.taxRegime ?? 'RESPONSABLE_IVA'}
          onChange={(v) => handleFieldChange('fiscal', 'taxRegime', v)}
          disabled={readOnly}
        >
          {TAX_REGIMES.map((regime) => (
            <option key={regime.value} value={regime.value}>
              {t('config.' + regime.labelKey)}
            </option>
          ))}
        </SelectField>

        <TextField
          label={t('config.fiscal.default_tax_rate')}
          value={((config?.fiscal.defaultTaxRate ?? 0.19) * 100).toString()}
          onChange={(v) => handleFieldChange('fiscal', 'defaultTaxRate', (parseFloat(v) || 0) / 100)}
          disabled={readOnly || config?.fiscal.taxRegime === 'NO_RESPONSABLE'}
          type="number"
          step="0.01"
          min="0"
          max="100"
          suffix="%"
        />
      </div>

      {/* DIAN Resolution */}
      <div className="border-t border-border pt-6 dark:border-gray-700">
        <h4 className="mb-4 text-sm font-semibold text-ink dark:text-gray-100">
          {t('config.fiscal.dian_resolution')}
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label={t('config.fiscal.dian_resolution_number')}
            value={config?.fiscal.dianResolutionNumber ?? ''}
            onChange={(v) => handleFieldChange('fiscal', 'dianResolutionNumber', v)}
            disabled={readOnly}
          />
          <TextField
            label={t('config.fiscal.dian_resolution_date')}
            value={config?.fiscal.dianResolutionDate ?? ''}
            onChange={(v) => handleFieldChange('fiscal', 'dianResolutionDate', v)}
            disabled={readOnly}
            type="date"
          />
          <TextField
            label={t('config.fiscal.dian_prefix')}
            value={config?.fiscal.dianResolutionPrefix ?? ''}
            onChange={(v) => handleFieldChange('fiscal', 'dianResolutionPrefix', v)}
            disabled={readOnly}
          />
          <TextField
            label={t('config.fiscal.invoice_number_format')}
            value={config?.fiscal.invoiceNumberFormat ?? ''}
            onChange={(v) => handleFieldChange('fiscal', 'invoiceNumberFormat', v)}
            disabled={readOnly}
          />
        </div>
      </div>

      {/* Invoice display options */}
      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h4 className="text-sm font-semibold text-ink dark:text-gray-100">
          Pantalla
        </h4>
        <CheckboxField
          label={t('config.fiscal.show_logo_on_receipt')}
          checked={config?.fiscal.showLogoOnReceipt ?? true}
          onChange={(v) => handleFieldChange('fiscal', 'showLogoOnReceipt', v)}
          disabled={readOnly}
        />
        <CheckboxField
          label={t('config.fiscal.show_qr_on_receipt')}
          checked={config?.fiscal.showQrOnReceipt ?? true}
          onChange={(v) => handleFieldChange('fiscal', 'showQrOnReceipt', v)}
          disabled={readOnly}
        />
      </div>

      {/* Header / Footer */}
      <div className="grid grid-cols-2 gap-4">
        <TextAreaField
          label={t('config.fiscal.invoice_header')}
          value={config?.fiscal.invoiceHeader ?? ''}
          onChange={(v) => handleFieldChange('fiscal', 'invoiceHeader', v)}
          disabled={readOnly}
        />
        <TextAreaField
          label={t('config.fiscal.invoice_footer')}
          value={config?.fiscal.invoiceFooter ?? ''}
          onChange={(v) => handleFieldChange('fiscal', 'invoiceFooter', v)}
          disabled={readOnly}
        />
      </div>
    </div>
  );

  // ---- Operation tab ----

  const renderOperationTab = (): React.ReactNode => (
    <StrictnessSection readOnly={readOnly} />
  );

  // ---- System preferences tab ----

  const renderPreferencesTab = (): React.ReactNode => (
    <div className="space-y-6">
      <h3 className="text-base font-semibold text-ink dark:text-gray-100">
        {t('config.tabs.preferences')}
      </h3>

      <div className="space-y-3">
        <CheckboxField
          label={t('config.workflow.auto_print_on_confirm')}
          checked={config?.workflow.autoPrintOnConfirm ?? true}
          onChange={(v) => handleFieldChange('workflow', 'autoPrintOnConfirm', v)}
          disabled={readOnly}
        />
        <CheckboxField
          label={t('config.workflow.print_duplicate_receipt')}
          checked={config?.workflow.printDuplicateReceipt ?? false}
          onChange={(v) => handleFieldChange('workflow', 'printDuplicateReceipt', v)}
          disabled={readOnly}
        />
        <SelectField
          label={t('config.workflow.auto_open_drawer_on_confirm')}
          value={config?.workflow.autoOpenDrawerOnConfirm ?? 'CASH_ONLY'}
          onChange={(v) => handleFieldChange('workflow', 'autoOpenDrawerOnConfirm', v)}
          disabled={readOnly}
        >
          <option value="ALWAYS">Siempre</option>
          <option value="CASH_ONLY">Solo efectivo</option>
          <option value="NEVER">Nunca</option>
        </SelectField>
        <CheckboxField
          label={t('config.workflow.suggestion_engine')}
          checked={config?.workflow.suggestionEngineEnabled ?? true}
          onChange={(v) => handleFieldChange('workflow', 'suggestionEngineEnabled', v)}
          disabled={readOnly}
        />
      </div>
    </div>
  );

  // ---- User preferences tab ----

  const renderUserPreferencesTab = (): React.ReactNode => (
    <UserPreferencesSection />
  );

  // ---- Loading / error states ----

  if (isLoading && !config) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <svg
            className="h-8 w-8 animate-spin text-ink-muted"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <p className="text-sm text-ink-muted dark:text-gray-400">
            {t('common.loading')}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-lg border border-error bg-error-container p-6 text-center dark:border-red-800 dark:bg-red-950">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto text-error"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="mt-3 text-sm text-error dark:text-red-400">
            {t('config.errors.load_failed')}: {error}
          </p>
        </div>
      </div>
    );
  }

  // ---- Main render ----

  return (
    <div className="flex h-full">
      {/* Tab sidebar */}
      <nav
        className="flex w-48 flex-col gap-1 border-r border-border bg-surface-variant p-3 dark:border-gray-700 dark:bg-gray-800/50"
        aria-label={t('config.tabs.company')}
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              aria-current={activeTab === tab.id ? 'page' : undefined}
              className={`
                flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium
                transition-colors
                focus-visible:outline-2 focus-visible:outline-offset-2
                focus-visible:outline-pharma
                ${
                  activeTab === tab.id
                    ? 'bg-success-container text-pharma dark:bg-pharma/20 dark:text-pharma'
                    : 'text-ink-muted hover:bg-surface-variant dark:text-gray-400 dark:hover:bg-gray-700'
                }
              `}
            >
              <Icon aria-hidden="true" />
              <span>{t('config.' + tab.i18nKey)}</span>
            </button>
          );
        })}
      </nav>

      {/* Content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-border bg-panel px-6 py-3 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-lg font-semibold text-ink dark:text-gray-100">
            {t('config.title')}
          </h2>
          <ActiveModeIndicator onClick={() => setActiveTab('operation')} />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              {renderTabContent()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Custom field editor modal */}
      <CustomFieldEditor
        open={customFieldEditorOpen}
        onOpenChange={setCustomFieldEditorOpen}
        mode={{
          kind: 'field',
          field: editingField,
        }}
        onSave={handleSaveCustomField}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Inline helper UI components
// ---------------------------------------------------------------------------

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  type?: string;
  className?: string;
  step?: string;
  min?: string | number;
  max?: string | number;
  placeholder?: string;
  suffix?: string;
}

const TextField: FC<TextFieldProps> = ({
  label,
  value,
  onChange,
  disabled = false,
  type = 'text',
  className = '',
  step,
  min,
  max,
  placeholder,
  suffix,
}) => (
  <label className={`block ${className}`}>
    <span className="text-sm font-medium text-ink dark:text-gray-300">
      {label}
    </span>
    <div className="relative mt-1">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        className={`block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma disabled:cursor-not-allowed disabled:bg-surface-variant disabled:text-ink-muted dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 ${suffix ? 'pr-8' : ''}`}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">
          {suffix}
        </span>
      )}
    </div>
  </label>
);

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}

const SelectField: FC<SelectFieldProps> = ({
  label,
  value,
  onChange,
  disabled = false,
  children,
}) => (
  <label className="block">
    <span className="text-sm font-medium text-ink dark:text-gray-300">
      {label}
    </span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma disabled:cursor-not-allowed disabled:bg-surface-variant disabled:text-ink-muted dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
    >
      {children}
    </select>
  </label>
);

interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

const CheckboxField: FC<CheckboxFieldProps> = ({
  label,
  checked,
  onChange,
  disabled = false,
}) => (
  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-panel px-4 py-3 transition-colors hover:bg-surface-variant dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      className="h-4 w-4 rounded border-border text-pharma focus:ring-pharma disabled:cursor-not-allowed"
    />
    <span className="text-sm text-ink dark:text-gray-100">{label}</span>
  </label>
);

interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const TextAreaField: FC<TextAreaFieldProps> = ({
  label,
  value,
  onChange,
  disabled = false,
}) => (
  <label className="block">
    <span className="text-sm font-medium text-ink dark:text-gray-300">
      {label}
    </span>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      rows={3}
      className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-pharma focus:outline-none focus:ring-1 focus:ring-pharma disabled:cursor-not-allowed disabled:bg-surface-variant disabled:text-ink-muted dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
    />
  </label>
);


