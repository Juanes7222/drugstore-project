/**
 * TenantConfigPage — main configuration page with tabs.
 *
 * Thin wiring container: owns all state, side-effects, and action handlers.
 * Presentational sub-components are imported from sibling files.
 *
 * Layout: sidebar with tab icons on left, content on right.
 * Top shows ActiveModeIndicator.
 * Tabs: Empresa, Fiscal, Operacion, Preferencias del sistema, Preferencias de usuario.
 *
 * @category Page
 */

import { type FC, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import {
  useTenantConfig,
  type CustomCompanyField,
  type CustomStrictnessToggle,
} from "../../../domain/config";
import { ActiveModeIndicator } from "./active-mode-indicator";
import { StrictnessSection } from "./strictness.section";
import { CustomFieldEditor } from "./custom-field-editor";
import { UserPreferencesSection } from "./user-preferences.section";
import { CompanyConfigTab } from "./company-config-tab";
import { FiscalConfigTab } from "./fiscal-config-tab";
import { SystemPreferencesTab } from "./system-preferences-tab";

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabId = "company" | "fiscal" | "operation" | "preferences" | "user-preferences";

interface TabDefinition {
  id: TabId;
  i18nKey: string;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
}

const TABS: TabDefinition[] = [
  {
    id: "company",
    i18nKey: "tabs.company",
    icon: (props) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    id: "fiscal",
    i18nKey: "tabs.fiscal",
    icon: (props) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    id: "operation",
    i18nKey: "tabs.operation",
    icon: (props) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    id: "preferences",
    i18nKey: "tabs.preferences",
    icon: (props) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
  },
  {
    id: "user-preferences",
    i18nKey: "tabs.user_preferences",
    icon: (props) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

// ---------------------------------------------------------------------------
// Page component
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

  const [activeTab, setActiveTab] = useState<TabId>("company");
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
    async (section: "fiscal" | "workflow", key: string, value: unknown) => {
      if (readOnly || !config) return;
      if (section === "fiscal") {
        await update({ fiscal: { ...config.fiscal, [key]: value } });
      } else {
        await update({ workflow: { ...config.workflow, [key]: value } });
      }
    },
    [config, update, readOnly],
  );

  // ---- Render tab content ----

  const renderTabContent = (): React.ReactNode => {
    switch (activeTab) {
      case "company":
        return (
          <CompanyConfigTab
            config={config}
            effectiveConfig={effectiveConfig}
            readOnly={readOnly}
            onFieldChange={handleFieldChange}
            onAddCustomField={handleAddCustomField}
            onEditCustomField={handleEditCustomField}
            onRemoveCustomField={handleRemoveCustomField}
          />
        );
      case "fiscal":
        return (
          <FiscalConfigTab
            config={config}
            readOnly={readOnly}
            onFieldChange={handleFieldChange}
          />
        );
      case "operation":
        return <StrictnessSection readOnly={readOnly} />;
      case "preferences":
        return (
          <SystemPreferencesTab
            config={config}
            readOnly={readOnly}
            onFieldChange={handleFieldChange}
          />
        );
      case "user-preferences":
        return <UserPreferencesSection />;
    }
  };

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
            {t("common.loading")}
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
            {t("config.errors.load_failed")}: {error}
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
        aria-label={t("config.tabs.company")}
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              aria-current={activeTab === tab.id ? "page" : undefined}
              className={`
                flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium
                transition-colors
                focus-visible:outline-2 focus-visible:outline-offset-2
                focus-visible:outline-pharma
                ${
                  activeTab === tab.id
                    ? "bg-success-container text-pharma dark:bg-pharma/20 dark:text-pharma"
                    : "text-ink-muted hover:bg-surface-variant dark:text-gray-400 dark:hover:bg-gray-700"
                }
              `}
            >
              <Icon aria-hidden="true" />
              <span>{t("config." + tab.i18nKey)}</span>
            </button>
          );
        })}
      </nav>

      {/* Content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-border bg-panel px-6 py-3 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-lg font-semibold text-ink dark:text-gray-100">
            {t("config.title")}
          </h2>
          <ActiveModeIndicator onClick={() => setActiveTab("operation")} />
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
          kind: "field",
          field: editingField,
        }}
        onSave={handleSaveCustomField}
      />
    </div>
  );
};
