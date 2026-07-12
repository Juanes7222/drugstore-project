/**
 * Update-settings section — embeddable within the app preferences/pane.
 *
 * Allows the user to toggle:
 * - autoDownload: automatically download available updates in the background.
 * - installOnClose: install pending updates when the app is closed.
 * - channel (STABLE / BETA): update channel selection (owner/manager only).
 *
 * All changes are persisted to the local Prisma UpdateState singleton
 * immediately via the update service.
 */

import { type FC, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateStore } from '../../../domain/updates/update.store';
import { getLocalDatabase } from '../../../infrastructure/local-database';
import type { UpdateChannel } from '@pharmacy/shared-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpdateSettingsSectionProps {
  /**
   * Whether to show the channel selector (owner/manager only).
   * Channel selection should be hidden for regular cashiers.
   */
  showChannelSelector?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const UpdateSettingsSection: FC<UpdateSettingsSectionProps> = ({
  showChannelSelector = false,
}) => {
  const { t } = useTranslation();

  // Subscribe to relevant store slices
  const autoDownload = useUpdateStore((s) => s.autoDownload);
  const installOnClose = useUpdateStore((s) => s.installOnClose);
  const channel = useUpdateStore((s) => s.channel);

  const handleAutoDownloadChange = useCallback(
    async (checked: boolean) => {
      const { prisma } = await getLocalDatabase();
      await useUpdateStore.getState().updateAndPersist(
        prisma as any,
        { autoDownload: checked },
      );
    },
    [],
  );

  const handleInstallOnCloseChange = useCallback(
    async (checked: boolean) => {
      const { prisma } = await getLocalDatabase();
      await useUpdateStore.getState().updateAndPersist(
        prisma as any,
        { installOnClose: checked },
      );
    },
    [],
  );

  const handleChannelChange = useCallback(
    async (newChannel: UpdateChannel) => {
      const { prisma } = await getLocalDatabase();
      await useUpdateStore.getState().updateAndPersist(
        prisma as any,
        { channel: newChannel },
      );
    },
    [],
  );

  return (
    <div className="space-y-4">
      {/* Auto-download */}
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          className="h-4 w-4 rounded"
          checked={autoDownload}
          onChange={(e) => handleAutoDownloadChange(e.target.checked)}
          style={{ accentColor: 'var(--color-pharma, #2563eb)' }}
        />
        <div>
          <p
            className="text-sm font-medium"
            style={{ color: 'var(--color-ink)' }}
          >
            {t('update.settings.auto_download_label')}
          </p>
          <p
            className="text-xs"
            style={{
              color: 'color-mix(in srgb, var(--color-ink) 50%, transparent)',
            }}
          >
            {t('update.settings.auto_download_desc')}
          </p>
        </div>
      </label>

      {/* Install on close */}
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          className="h-4 w-4 rounded"
          checked={installOnClose}
          onChange={(e) => handleInstallOnCloseChange(e.target.checked)}
          style={{ accentColor: 'var(--color-pharma, #2563eb)' }}
        />
        <div>
          <p
            className="text-sm font-medium"
            style={{ color: 'var(--color-ink)' }}
          >
            {t('update.settings.install_on_close_label')}
          </p>
          <p
            className="text-xs"
            style={{
              color: 'color-mix(in srgb, var(--color-ink) 50%, transparent)',
            }}
          >
            {t('update.settings.install_on_close_desc')}
          </p>
        </div>
      </label>

      {/* Channel selector (owner/manager only) */}
      {showChannelSelector && (
        <div className="pt-2">
          <p
            className="mb-2 text-sm font-medium"
            style={{ color: 'var(--color-ink)' }}
          >
            {t('update.settings.channel_label')}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                channel === 'STABLE'
                  ? 'text-white'
                  : 'opacity-60 hover:opacity-80'
              }`}
              style={{
                backgroundColor:
                  channel === 'STABLE'
                    ? 'var(--color-pharma, #2563eb)'
                    : 'color-mix(in srgb, var(--color-ink) 10%, transparent)',
                color:
                  channel === 'STABLE'
                    ? '#ffffff'
                    : 'var(--color-ink)',
              }}
              onClick={() => handleChannelChange('STABLE' as UpdateChannel)}
            >
              {t('update.settings.channel_stable')}
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                channel === 'BETA'
                  ? 'text-white'
                  : 'opacity-60 hover:opacity-80'
              }`}
              style={{
                backgroundColor:
                  channel === 'BETA'
                    ? 'var(--color-pharma, #2563eb)'
                    : 'color-mix(in srgb, var(--color-ink) 10%, transparent)',
                color:
                  channel === 'BETA'
                    ? '#ffffff'
                    : 'var(--color-ink)',
              }}
              onClick={() => handleChannelChange('BETA' as UpdateChannel)}
            >
              {t('update.settings.channel_beta')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
