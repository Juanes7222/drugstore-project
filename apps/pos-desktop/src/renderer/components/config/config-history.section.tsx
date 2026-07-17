/**
 * ConfigHistorySection — change history table with rollback support.
 *
 * Shows version, change type, user, date. "Restaurar" button per version.
 * "No hay cambios" empty state.
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
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-ink dark:text-gray-100">
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
            className="text-gray-300 dark:text-gray-600"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <p className="mt-3 text-sm text-ink-muted dark:text-gray-400">
            {t('config.history.no_history')}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-surface-variant dark:bg-gray-800">
              <tr>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-muted dark:text-gray-400"
                >
                  {t('config.history.version')}
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-muted dark:text-gray-400"
                >
                  {t('config.history.change_type')}
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-muted dark:text-gray-400"
                >
                  {t('config.history.actor')}
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-muted dark:text-gray-400"
                >
                  {t('config.history.date')}
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-ink-muted dark:text-gray-400"
                >
                  {t('common.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-panel dark:divide-gray-700 dark:bg-gray-900">
              {entries.map((entry) => {
                const isCurrent = entry.configVersion === currentVersion;
                return (
                  <tr
                    key={entry.id}
                    className={`transition-colors hover:bg-surface-variant dark:hover:bg-gray-800 ${
                      isCurrent ? 'bg-blue-50/50 dark:bg-blue-950/30' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-ink dark:text-gray-100">
                      v{entry.configVersion}
                      {isCurrent && (
                        <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                          {t('config.presets.active')}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-muted dark:text-gray-300">
                      {getChangeTypeLabel(entry.changeType)}
                      {entry.fieldPath && (
                        <span className="ml-1 text-xs text-ink-muted">
                          ({entry.fieldPath})
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-muted dark:text-gray-300">
                      {entry.actorUserId.slice(0, 8)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-muted dark:text-gray-400">
                      {formatDate(entry.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {!isCurrent && !readOnly && (
                        <button
                          type="button"
                          onClick={() => onRollback(entry.configVersion)}
                          className="rounded-lg bg-pharma px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-pharma/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma"
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
