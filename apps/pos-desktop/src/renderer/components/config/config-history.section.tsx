/**
 * ConfigHistorySection — change history table with rollback support.
 *
 * Shows version, change type, user, date. "Restaurar" button per version.
 * Uses pos-return-table classes for table styling consistent with the app.
 */
import { type FC, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConfigChangelogEntry } from '../../../domain/config';

export interface ConfigHistorySectionProps {
  /** List of changelog entries. */
  entries: ConfigChangelogEntry[];
  /** Rollback to a specific version. */
  onRollback: (version: number) => void;
  /** Current config version. */
  currentVersion: number;
  /** Loading state. */
  loading?: boolean;
  /** If true, disallows editing. */
  readOnly?: boolean;
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  PRESET_APPLIED: 'Cambio de preset',
  FIELD_UPDATED: 'Campo actualizado',
  CUSTOM_FIELD_ADDED: 'Campo personalizado agregado',
  CUSTOM_FIELD_UPDATED: 'Campo personalizado actualizado',
  CUSTOM_FIELD_REMOVED: 'Campo personalizado eliminado',
  CUSTOM_TOGGLE_ADDED: 'Toggle personalizado agregado',
  CUSTOM_TOGGLE_UPDATED: 'Toggle personalizado actualizado',
  CUSTOM_TOGGLE_REMOVED: 'Toggle personalizado eliminado',
  NAMED_PRESET_SAVED: 'Preset guardado',
  NAMED_PRESET_APPLIED: 'Preset aplicado',
  ROLLBACK: 'Rollback',
  RESET_TO_PRESET: 'Restablecido a preset',
};

export const ConfigHistorySection: FC<ConfigHistorySectionProps> = ({
  entries,
  onRollback,
  currentVersion,
  loading = false,
  readOnly = false,
}) => {
  const { t } = useTranslation();

  const formatDate = useCallback((dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, []);

  const getChangeTypeLabel = useCallback(
    (changeType: string): string => {
      return CHANGE_TYPE_LABELS[changeType] ?? changeType;
    },
    [],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <svg
          className="h-6 w-6 animate-spin text-ink-muted"
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
      </div>
    );
  }

  return (
    <div className="space-y-pos-md">
      <h3 className="text-ui font-semibold text-ink">
        {t('config.history.title')}
      </h3>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-ink-muted/40"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <p className="mt-pos-md text-body-sm text-ink-muted">
            {t('config.history.no_history')}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-surface-variant">
              <tr>
                <th
                  scope="col"
                  className="px-pos-md py-pos-sm text-left text-caption font-semibold uppercase tracking-wider text-ink-muted"
                >
                  {t('config.history.version')}
                </th>
                <th
                  scope="col"
                  className="px-pos-md py-pos-sm text-left text-caption font-semibold uppercase tracking-wider text-ink-muted"
                >
                  {t('config.history.change_type')}
                </th>
                <th
                  scope="col"
                  className="px-pos-md py-pos-sm text-left text-caption font-semibold uppercase tracking-wider text-ink-muted"
                >
                  {t('config.history.actor')}
                </th>
                <th
                  scope="col"
                  className="px-pos-md py-pos-sm text-left text-caption font-semibold uppercase tracking-wider text-ink-muted"
                >
                  {t('config.history.date')}
                </th>
                <th
                  scope="col"
                  className="px-pos-md py-pos-sm text-right text-caption font-semibold uppercase tracking-wider text-ink-muted"
                >
                  {t('common.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-panel">
              {entries.map((entry) => {
                const isCurrent = entry.configVersion === currentVersion;
                return (
                  <tr
                    key={entry.id}
                    className={`transition-colors hover:bg-surface-variant ${
                      isCurrent ? 'bg-pharma/[0.04]' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-pos-md py-pos-sm text-body-sm font-medium text-ink">
                      v{entry.configVersion}
                      {isCurrent && (
                        <span className="ml-pos-sm rounded-full bg-pharma/10 px-pos-sm py-0.5 text-caption font-semibold text-pharma">
                          {t('config.presets.active')}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-pos-md py-pos-sm text-body-sm text-ink-muted">
                      {getChangeTypeLabel(entry.changeType)}
                      {entry.fieldPath && (
                        <span className="ml-1 text-caption text-ink-muted">
                          ({entry.fieldPath})
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-pos-md py-pos-sm text-body-sm text-ink-muted">
                      {entry.actorUserId.slice(0, 8)}
                    </td>
                    <td className="whitespace-nowrap px-pos-md py-pos-sm text-body-sm text-ink-muted">
                      {formatDate(entry.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-pos-md py-pos-sm text-right">
                      {!isCurrent && !readOnly && (
                        <button
                          type="button"
                          onClick={() => onRollback(entry.configVersion)}
                          className="pos-button pos-button-primary text-caption"
                        >
                          {t('config.history.rollback')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
