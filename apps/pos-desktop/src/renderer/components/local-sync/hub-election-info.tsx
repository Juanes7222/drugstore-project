/**
 * Hub-election explanation component.
 *
 * Shows the auto-election scoring breakdown for each peer, sorted by
 * score descending, with a short explanation of how scores are computed.
 *
 * @category Local Sync
 */

import { type FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Minus } from 'lucide-react';
import { HubStatusIcon } from './hub-status-icon';
import type { HubScore } from '@pharmacy/shared-types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface HubElectionInfoProps {
  /** Hub scores for all peers. */
  scores: HubScore[];
  /** Workstation ID of the current hub, or null. */
  currentHubId: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCORE_COLUMNS: { key: keyof HubScoreFactor; labelKey: string; pct: number }[] = [
  { key: 'onlineTimeHours', labelKey: 'uptime', pct: 40 },
  { key: 'stabilityFactor', labelKey: 'stability', pct: 30 },
  { key: 'diskSpaceGb', labelKey: 'disk', pct: 15 },
  { key: 'isAlwaysOn', labelKey: 'always_on', pct: 15 },
];

type HubScoreFactor = Pick<HubScore, 'onlineTimeHours' | 'stabilityFactor' | 'diskSpaceGb' | 'isAlwaysOn'>;

// ---------------------------------------------------------------------------
// Sub-component: Factor bar
// ---------------------------------------------------------------------------

interface FactorBarProps {
  value: number | boolean;
  maxValue: number;
}

const FactorBar: FC<FactorBarProps> = ({ value, maxValue }) => {
  const numericValue = typeof value === 'boolean' ? (value ? 100 : 0) : value;
  const pct = maxValue > 0 ? Math.min((numericValue / maxValue) * 100, 100) : 0;

  return (
    <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 10%, transparent)' }}>
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${pct}%`,
          backgroundColor: 'var(--color-accent)',
        }}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const HubElectionInfo: FC<HubElectionInfoProps> = ({ scores, currentHubId }) => {
  const { t } = useTranslation();

  const sorted = useMemo(
    () => [...scores].sort((a, b) => b.score - a.score),
    [scores],
  );

  // Compute max values for factor bars (scoped to current dataset).
  const maxValues = useMemo(() => {
    if (sorted.length === 0) {
      return { onlineTimeHours: 1, stabilityFactor: 1, diskSpaceGb: 1 };
    }
    return {
      onlineTimeHours: Math.max(...sorted.map((s) => s.onlineTimeHours), 1),
      stabilityFactor: Math.max(...sorted.map((s) => s.stabilityFactor), 1),
      diskSpaceGb: Math.max(...sorted.map((s) => s.diskSpaceGb), 1),
    };
  }, [sorted]);

  if (sorted.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-white p-4" style={{ borderColor: 'var(--color-border)' }}>
      {/* Title */}
      <h3 className="mb-1 text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
        {t('local_sync.hub_scores_title')}
      </h3>

      {/* Explanation */}
      <p className="mb-4 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
        {t('local_sync.hub_score_detail')}
      </p>

      {/* Factor column headers */}
      <div className="mb-2 grid grid-cols-[1fr_3rem_1fr_1fr_1fr_1fr] gap-2 px-1 text-xs font-medium" style={{ color: 'var(--color-ink-muted)' }}>
        <span>{t('common.all_roles')}</span>
        <span className="text-right">{t('local_sync.hub_scores_title')}</span>
        {SCORE_COLUMNS.map((col) => (
          <span key={col.key} className="text-center text-[10px]">
            {col.pct}%
          </span>
        ))}
      </div>

      {/* Peer rows */}
      <div className="space-y-2">
        {sorted.map((score) => {
          const isCurrent = score.workstationId === currentHubId;

          return (
            <div
              key={score.workstationId}
              className={`grid grid-cols-[1fr_3rem_1fr_1fr_1fr_1fr] items-center gap-2 rounded-md px-1 py-1.5 text-xs ${
                isCurrent ? 'font-medium' : ''
              }`}
              style={{
                backgroundColor: isCurrent
                  ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)'
                  : 'transparent',
                color: 'var(--color-ink)',
              }}
            >
              {/* Peer name */}
              <div className="flex items-center gap-1.5 truncate">
                <HubStatusIcon
                  status={score.isOnline ? 'connected' : 'disconnected'}
                  size={12}
                  ariaLabel=""
                />
                <span className="truncate">{score.friendlyName}</span>
                {isCurrent && (
                  <span
                    className="ml-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
                      color: 'var(--color-accent)',
                    }}
                  >
                    {t('local_sync.current_hub')}
                  </span>
                )}
              </div>

              {/* Total score */}
              <span className="text-right tabular-nums" style={{ color: 'var(--color-accent)' }}>
                {score.score.toFixed(1)}
              </span>

              {/* Factor bars */}
              {SCORE_COLUMNS.map((col) => (
                <div key={col.key} className="flex flex-col items-center gap-0.5">
                  <FactorBar
                    value={score[col.key as keyof HubScoreFactor]}
                    maxValue={maxValues[col.key as keyof typeof maxValues]}
                  />
                  <span className="text-[10px] tabular-nums" style={{ color: 'var(--color-ink-muted)' }}>
                    {typeof score[col.key as keyof HubScoreFactor] === 'boolean'
                      ? (score[col.key as keyof HubScoreFactor]
                        ? <Check size={10} strokeWidth={2.5} aria-hidden="true" />
                        : <Minus size={10} strokeWidth={2} aria-hidden="true" />)
                      : (score[col.key as keyof HubScoreFactor] as number).toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};
