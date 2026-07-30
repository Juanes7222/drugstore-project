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
  Building2,
  Receipt,
  ToggleLeft,
  Settings2,
  ShoppingCart,
  Percent,
  UserCircle,
  type LucideIcon,
} from "lucide-react";
import { AlertCircleIcon } from "@/components/ui/icons";
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
import { PurchasesConfigTab } from "./purchases-config-tab";
import { SalesConfigTab } from "./sales-config-tab";

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabId = "company" | "fiscal" | "operation" | "preferences" | "user-preferences" | "purchases" | "sales";

interface TabDefinition {
  id: TabId;
  i18nKey: string;
  Icon: LucideIcon;
}

const TABS: TabDefinition[] = [
  { id: "company", i18nKey: "tabs.company", Icon: Building2 },
  { id: "fiscal", i18nKey: "tabs.fiscal", Icon: Receipt },
  { id: "operation", i18nKey: "tabs.operation", Icon: ToggleLeft },
  { id: "preferences", i18nKey: "tabs.preferences", Icon: Settings2 },
  { id: "user-preferences", i18nKey: "tabs.user_preferences", Icon: UserCircle },
  { id: "purchases", i18nKey: "tabs.purchases", Icon: ShoppingCart },
  { id: "sales", i18nKey: "tabs.sales", Icon: Percent },
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
      case "purchases":
        return <PurchasesConfigTab />;
      case "sales":
        return <SalesConfigTab />;
    }
  };

  // ---- Loading / error states ----

  if (isLoading && !config) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-pos-md">
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
          <p className="text-body-sm text-ink-muted">
            {t("common.loading")}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-sm border border-error bg-error-container p-6 text-center">
          <AlertCircleIcon size={32} className="mx-auto text-error" />
          <p className="mt-pos-md text-body-sm text-error">
            {t("config.errors.load_failed")}: {error}
          </p>
        </div>
      </div>
    );
  }

  // ---- Main render ----

  return (
    <div className="flex h-full" style={{ backgroundColor: 'var(--color-surface)' }}>
      {/* Tab sidebar */}
      <nav
        className="relative flex w-48 flex-col border-r border-border bg-surface-variant p-pos-xs"
        aria-label={t("config.tabs.company")}
      >
        {TABS.map((tab) => {
          const Icon = tab.Icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              aria-current={isActive ? "page" : undefined}
              className={`
                relative flex items-center gap-pos-md px-pos-md py-pos-sm text-body-sm font-medium
                transition-colors duration-150
                focus-visible:outline-2 focus-visible:outline-offset-[-2px]
                focus-visible:outline-pharma
                ${isActive ? "text-pharma" : "text-ink-muted hover:text-ink"}
              `}
            >
              {/* Active indicator — animated pill using layoutId */}
              {isActive && (
                <motion.div
                  className="absolute inset-y-1 left-1 right-1 rounded-sm bg-success-container"
                  layoutId="config-tab-active"
                  transition={{ type: "spring", stiffness: 400, damping: 35 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-pos-sm">
                <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
                <span>{t("config." + tab.i18nKey)}</span>
              </span>
            </button>
          );
        })}
      </nav>

      {/* Content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-border bg-panel px-pos-xl py-pos-md">
          <h2 className="text-ui font-semibold text-ink">
            {t("config.title")}
          </h2>
          <ActiveModeIndicator onClick={() => setActiveTab("operation")} />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-pos-xl py-pos-lg">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
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
