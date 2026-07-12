/**
 * Update-progress — Full-screen overlay during install.
 *
 * Shows the current update version, a progress bar, estimated time remaining,
 * and a prominent "Do not close the app" warning. Rendered as a fixed overlay
 * that covers the entire viewport so user interaction is blocked during the
 * install.
 */

import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpdateProgressProps {
  /** Whether the overlay is visible. */
  visible: boolean;
  /** Version being installed. */
  version: string;
  /** Download/install progress percentage (0–100). */
  progressPercent: number;
  /** Phase label to display. */
  phase: 'downloading' | 'verifying' | 'installing' | 'migrating' | 'restarting';
  /** Estimated time remaining in seconds (null if unknown). */
  etaSeconds?: number | null;
  /** Download speed string (e.g. "2.4 MB/s"), displayed during download phase. */
  speed?: string;
  /** Optional error message to display. */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Phase config
// ---------------------------------------------------------------------------

const PHASE_LABELS: Record<string, string> = {
  downloading: 'update.progress.phase_downloading',
  verifying: 'update.progress.phase_verifying',
  installing: 'update.progress.phase_installing',
  migrating: 'update.progress.phase_migrating',
  restarting: 'update.progress.phase_restarting',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const UpdateProgress: FC<UpdateProgressProps> = ({
  visible,
  version,
  progressPercent,
  phase,
  etaSeconds,
  speed,
  errorMessage,
}) => {
  const { t } = useTranslation();

  if (!visible) return null;

  const formatEta = (seconds: number): string => {
    if (seconds < 60) return t('update.progress.eta_seconds', { count: Math.round(seconds) });
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return t('update.progress.eta_minutes', { minutes: mins, seconds: secs });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.85)' }}
      role="dialog"
      aria-modal="true"
      aria-label={t('update.progress.aria_label')}
    >
      <div className="w-full max-w-md px-6 text-center">
        {/* Pulse animation */}
        <div
          className="mx-auto mb-6 h-16 w-16 rounded-full"
          style={{
            background:
              errorMessage
                ? 'var(--color-urgency, #dc2626)'
                : 'var(--color-pharma, #2563eb)',
            opacity: 0.2,
            animation: 'update-pulse 1.5s ease-in-out infinite',
          }}
          aria-hidden="true"
        />

        {/* Title */}
        <h2
          className="text-xl font-bold text-white"
        >
          {t('update.progress.title', { version })}
        </h2>

        {/* Phase label */}
        <p className="mt-2 text-sm text-white/60">
          {t(PHASE_LABELS[phase] ?? 'update.progress.phase_installing')}
        </p>

        {/* Progress bar */}
        <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full transition-all duration-300 ease-out"
            style={{
              width: `${Math.min(progressPercent, 100)}%`,
              backgroundColor: errorMessage
                ? 'var(--color-urgency, #dc2626)'
                : 'var(--color-pharma, #2563eb)',
            }}
          />
        </div>

        {/* Progress percentage */}
        <p className="mt-2 text-sm font-mono text-white/80">
          {Math.round(progressPercent)}%
        </p>

        {/* Speed and ETA */}
        {phase === 'downloading' && speed && (
          <p className="mt-1 text-xs text-white/50">
            {speed}
            {etaSeconds != null && etaSeconds > 0
              ? ` · ${formatEta(etaSeconds)}`
              : ''}
          </p>
        )}

        {phase !== 'downloading' && etaSeconds != null && etaSeconds > 0 && (
          <p className="mt-1 text-xs text-white/50">
            {formatEta(etaSeconds)}
          </p>
        )}

        {/* Error message */}
        {errorMessage && (
          <p className="mt-4 rounded-md bg-red-900/40 px-3 py-2 text-sm text-red-300">
            {errorMessage}
          </p>
        )}

        {/* Warning */}
        <p
          className="mt-8 text-sm font-medium tracking-wide text-yellow-400"
        >
          {t('update.progress.do_not_close')}
        </p>
      </div>

      {/* Keyframe animation for the pulse */}
      <style>{`
        @keyframes update-pulse {
          0%, 100% { transform: scale(1); opacity: 0.2; }
          50% { transform: scale(1.15); opacity: 0.35; }
        }
      `}</style>
    </div>
  );
};
