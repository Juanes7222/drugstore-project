/**
 * HelpViewer — full-screen overlay for bundled Markdown help content.
 *
 * Opened from F1 (context help), the command palette, or an error toast with a
 * help link. Provides a searchable index sidebar and renders Markdown topics
 * with clean domain-grounded typography.
 *
 * Two modes:
 *   - Index mode (default): grouped topic list in the sidebar, welcome/home
 *     content in the right pane.
 *   - Topic mode: selected topic rendered as styled Markdown in the right pane.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'motion/react';
import { type FC } from 'react';
import { useHelpViewer } from '../../hooks/use-help-viewer';
import { useUserPreferencesStore } from '../../../stores/user-preferences.store';
import { HelpSidebar } from './help-sidebar';
import { HelpContentArea } from './help-content-area';

export const HelpViewer: FC = () => {
  const {
    helpOpen,
    searchQuery,
    setSearchQuery,
    selectedTopicId,
    selectedTopic,
    isProcedure,
    groupedEntries,
    helpTopicId,
    checkedSteps,
    searchInputRef,
    handleOpenChange,
    handleSelectTopic,
    handleGoToIndex,
    handleSearchKeyDown,
    handleToggleStep,
  } = useHelpViewer();

  const wasHelpPageViewedRecently = useUserPreferencesStore(
    (s) => s.wasHelpPageViewedRecently,
  );

  return (
    <Dialog.Root open={helpOpen} onOpenChange={handleOpenChange}>
      <AnimatePresence>
        {helpOpen && (
          <Dialog.Portal forceMount>
            {/* Overlay */}
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-40"
                style={{
                  backgroundColor:
                    'color-mix(in srgb, var(--color-ink) 40%, transparent)',
                  backdropFilter: 'blur(4px)',
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              />
            </Dialog.Overlay>

            {/* Panel */}
            <Dialog.Content asChild>
              <motion.div
                className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-full max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-hidden focus-visible:outline-none"
                style={{
                  backgroundColor: 'var(--color-panel)',
                  borderRadius: 'var(--radius-pos)',
                  boxShadow: 'var(--shadow-pos-elevated)',
                }}
                initial={{ opacity: 0, scale: 0.96, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -8 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                {/* Sidebar — index / search */}
                <HelpSidebar
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onSearchKeyDown={handleSearchKeyDown}
                  groupedEntries={groupedEntries}
                  selectedTopicId={selectedTopicId}
                  helpTopicId={helpTopicId}
                  onSelectTopic={handleSelectTopic}
                  searchInputRef={searchInputRef}
                  entryHasRecentView={(key) =>
                    wasHelpPageViewedRecently(key)
                  }
                />

                {/* Content area */}
                <HelpContentArea
                  selectedTopic={selectedTopic}
                  helpTopicId={helpTopicId}
                  isProcedure={isProcedure}
                  checkedSteps={checkedSteps}
                  onToggleStep={handleToggleStep}
                  onGoToIndex={handleGoToIndex}
                  groupedEntries={groupedEntries}
                  onSelectTopic={handleSelectTopic}
                />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
};
