/**
 * About page — Shows current version, latest available version, update check
 * button, recent update changelogs, and link to full history.
 *
 * This is the wiring container (thin page) that connects the UpdateService
 * from the service context to the presentational sub-components. Owned by
 * the pos-local agent for logic wiring; any purely presentational
 * sub-components should be split into src/renderer/components/update/ and
 * delegated to the frontend-pos agent.
 */

import { type FC, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateService } from '../../components/common/service-context';
import { useUpdateStore } from '../../../domain/updates/update.store';
import { getLocalDatabase } from '../../../infrastructure/local-database';
import { UpdateOutcome } from '@pharmacy/shared-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HistoryEntry {
  version: string;
  appliedAt: string;
  outcome: string;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AboutPage: FC = () => {
  const { t } = useTranslation();
  const updateService = useUpdateService();
  const storeState = useUpdateStore();

  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load recent history on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Load the last 5 UpdateAttempt records from Prisma
        const { prisma } = await getLocalDatabase();
        const prismaClient = prisma as {
          updateAttempt: {
            findMany: (args: {
              orderBy: { at: 'desc' | 'asc' };
              take: number;
            }) => Promise<
              Array<{
                fromVersion: string;
                at: Date;
                outcome: string;
                errorMessage: string | null;
                toVersion: string | null;
              }>
            >;
          };
        };

        const rows = await prismaClient.updateAttempt.findMany({
          orderBy: { at: 'desc' },
          take: showFullHistory ? 20 : 5,
        });

        if (!cancelled) {
          setHistory(
            rows.map((r) => ({
              version: r.toVersion ?? r.fromVersion,
              appliedAt: r.at.toISOString(),
              outcome: r.outcome,
              errorMessage: r.errorMessage,
            })),
          );
        }
      } catch {
        // History loading is best-effort
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showFullHistory]);

  const handleCheckForUpdate = useCallback(async () => {
    setChecking(true);
    setCheckResult(null);
    setError(null);

    try {
      const result = await updateService.checkForUpdate('MANUAL');
      if (result.updateAvailable) {
        setCheckResult(
          t('update.about.update_available', { version: result.version }),
        );
      } else {
        setCheckResult(t('update.about.up_to_date'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, [updateService, t]);

  return (
    <section
      aria-label={t('update.about.title')}
      className="flex h-full flex-col overflow-y-auto p-pos-md"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      <div className="mx-auto w-full max-w-2xl space-y-6">
        {/* Header */}
        <div>
          <h1
            className="text-heading font-bold"
            style={{ color: 'var(--color-ink)' }}
          >
            {t('update.about.title')}
          </h1>
        </div>

        {/* Current version card */}
        <div
          className="pos-panel rounded-lg p-4"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-ink) 4%, transparent)',
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p
                className="text-sm font-medium"
                style={{
                  color: 'color-mix(in srgb, var(--color-ink) 60%, transparent)',
                }}
              >
                {t('update.about.current_version')}
              </p>
              <p className="mt-1 text-lg font-bold font-mono" style={{ color: 'var(--color-ink)' }}>
                {storeState.currentVersion}
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-pharma, #2563eb)' }}
              disabled={checking}
              onClick={handleCheckForUpdate}
            >
              {checking
                ? t('update.about.checking')
                : t('update.about.check_for_updates')}
            </button>
          </div>

          {/* Check result */}
          {checkResult && (
            <p
              className="mt-3 text-sm font-medium"
              style={{ color: 'var(--color-pharma, #2563eb)' }}
            >
              {checkResult}
            </p>
          )}

          {/* Error */}
          {error && (
            <p
              className="mt-3 text-sm font-medium"
              style={{ color: 'var(--color-urgency, #dc2626)' }}
            >
              {error}
            </p>
          )}
        </div>

        {/* Latest available version */}
        {storeState.lastAvailableVersion && (
          <div
            className="pos-panel rounded-lg p-4"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-pharma) 8%, transparent)',
            }}
          >
            <p
              className="text-sm font-medium"
              style={{
                color: 'color-mix(in srgb, var(--color-ink) 60%, transparent)',
              }}
            >
              {t('update.about.latest_available')}
            </p>
            <p className="mt-1 font-bold font-mono" style={{ color: 'var(--color-ink)' }}>
              {storeState.lastAvailableVersion}
            </p>
            {storeState.lastAvailableChangelog && (
              <p className="mt-2 text-sm leading-relaxed" style={{
                color: 'color-mix(in srgb, var(--color-ink) 70%, transparent)',
              }}>
                {storeState.lastAvailableChangelog}
              </p>
            )}
          </div>
        )}

        {/* Recent history */}
        <div>
          <h2
            className="text-body font-bold"
            style={{ color: 'var(--color-ink)' }}
          >
            {t('update.about.recent_history')}
          </h2>

          <div className="mt-3 space-y-2">
            {history.length === 0 ? (
              <p
                className="text-sm"
                style={{
                  color: 'color-mix(in srgb, var(--color-ink) 50%, transparent)',
                }}
              >
                {t('update.about.no_history')}
              </p>
            ) : (
              history.map((entry, index) => (
                <div
                  key={`${entry.version}-${entry.appliedAt}-${index}`}
                  className="flex items-center justify-between rounded-md px-3 py-2"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--color-ink) 3%, transparent)',
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-sm font-medium truncate"
                      style={{ color: 'var(--color-ink)' }}
                    >
                      {entry.outcome === UpdateOutcome.INSTALL_COMPLETED
                        ? t('update.about.history_installed', {
                            version: entry.version,
                          })
                        : t('update.about.history_attempt', {
                            outcome: entry.outcome,
                          })}
                    </p>
                    <p
                      className="text-xs"
                      style={{
                        color: 'color-mix(in srgb, var(--color-ink) 50%, transparent)',
                      }}
                    >
                      {new Date(entry.appliedAt).toLocaleDateString()}
                    </p>
                  </div>
                  {entry.errorMessage && (
                    <span
                      className="ml-2 text-xs"
                      style={{ color: 'var(--color-urgency, #dc2626)' }}
                    >
                      {t('update.about.history_failed')}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          {history.length > 0 && (
            <button
              type="button"
              className="mt-3 text-sm font-medium underline underline-offset-2 hover:no-underline"
              style={{ color: 'var(--color-pharma)' }}
              onClick={() => setShowFullHistory(!showFullHistory)}
            >
              {showFullHistory
                ? t('update.about.show_less')
                : t('update.about.show_full_history')}
            </button>
          )}
        </div>

        {/* Update channel (read-only display) */}
        <div
          className="rounded-lg p-3"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-ink) 3%, transparent)',
          }}
        >
          <p
            className="text-xs"
            style={{
              color: 'color-mix(in srgb, var(--color-ink) 50%, transparent)',
            }}
          >
            {t('update.about.channel_label')}:{' '}
            <span className="font-medium">{storeState.channel}</span>
          </p>
        </div>
      </div>
    </section>
  );
};
