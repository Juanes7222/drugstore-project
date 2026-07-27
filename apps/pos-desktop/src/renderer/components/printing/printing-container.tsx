/**
 * PrintingContainer — tabbed container for print queue and printers.
 *
 * Provides a unified view with two tabs: "Cola de impresión" (PrintQueuePage)
 * and "Impresoras" (PrintersPage). The setup wizard remains a separate screen.
 */

import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { PrintQueuePage } from './print-queue.page';
import { PrintersPage } from './printers.page';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

interface TabDef {
  id: 'queue' | 'printers';
  labelKey: string;
}

const TABS: TabDef[] = [
  { id: 'queue', labelKey: 'printing.container.tab_queue' },
  { id: 'printers', labelKey: 'printing.container.tab_printers' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PrintingContainer: FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'queue' | 'printers'>('queue');

  return (
    <section
      aria-label={t('printing.container.title', 'Impresión')}
      className="flex h-full flex-col"
    >
      {/* Tab bar */}
      <div
        className="flex shrink-0 items-center gap-1 border-b border-border px-6"
        role="tablist"
        aria-label={t('printing.container.tablist_label', 'Secciones de impresión')}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`printing-panel-${tab.id}`}
              className={`relative px-4 py-3 text-body-sm font-medium transition-colors ${
                isActive
                  ? 'text-pharma'
                  : 'text-ink-muted hover:text-ink'
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {t(tab.labelKey)}
              {isActive && (
                <motion.span
                  layoutId="printing-active-tab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-pharma"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab panels */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === 'queue' && (
            <motion.div
              key="queue-panel"
              id="printing-panel-queue"
              role="tabpanel"
              aria-label={t('printing.container.tab_queue', 'Cola de impresión')}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.15 }}
              className="h-full"
            >
              <PrintQueuePage />
            </motion.div>
          )}
          {activeTab === 'printers' && (
            <motion.div
              key="printers-panel"
              id="printing-panel-printers"
              role="tabpanel"
              aria-label={t('printing.container.tab_printers', 'Impresoras')}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.15 }}
              className="h-full"
            >
              <PrintersPage />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
};
