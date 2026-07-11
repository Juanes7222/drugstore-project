/**
 * Step-up authorization modal.
 *
 * Triggered when an operation requires elevated authorization (manager PIN,
 * remote approval, or one-time code).
 *
 * Three tabs:
 * 1. PIN del manager aquí — manager enters their PIN on the same workstation
 * 2. Aprobación remota — sends a request to logged-in managers
 * 3. Código de un solo uso — manager has generated a 6-digit code elsewhere
 */
import { type FC, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RoleType } from '@pharmacy/shared-types';
import { PinKeypad } from './pin-keypad.component';
import { createAuthService, AuthService } from '../../../domain/auth/auth.service';
import { API_BASE_URL } from '@infra/config';

interface StepUpModalProps {
  operationType: string;
  operationId?: string;
  workstationId: string;
  requiredRole: RoleType;
  onApproved: (approvalToken: string) => void;
  onDenied?: () => void;
  onCancel: () => void;
  authService: AuthService;
}

export const StepUpModal: FC<StepUpModalProps> = ({
  operationType,
  operationId,
  workstationId,
  requiredRole,
  onApproved,
  onCancel,
  authService: _authService,
}) => {
  const { t } = useTranslation();
  const [authService] = useState(() =>
    createAuthService({
      baseUrl: API_BASE_URL,
    }),
  );

  const [tab, setTab] = useState<'pin' | 'remote' | 'code'>('pin');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [remoteStatus, setRemoteStatus] = useState<'idle' | 'sent' | 'approved' | 'denied'>('idle');
  const [countdown, setCountdown] = useState(300); // 5 minutes

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) {
      setPinError(t('step_up.request_expired'));
      return;
    }
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Create the step-up request
  const createRequest = useCallback(async () => {
    try {
      const result = await authService.requestStepUp({
        operationType,
        operationId,
        workstationId,
        requiredRole,
        method: tab === 'pin' ? 'PIN' : tab === 'remote' ? 'REMOTE' : 'CODE',
      });
      return result;
    } catch (err) {
      setPinError(t('step_up.create_error'));
      return null;
    }
  }, [operationType, operationId, workstationId, requiredRole, tab, authService]);

  // PIN approval
  const handlePinComplete = useCallback(
    async (_pin: string) => {
      setIsLoading(true);
      setPinError(null);

      try {
        const req = await createRequest();
        if (!req) {
          setIsLoading(false);
          return;
        }

        // First create the request, then approve it with the manager's PIN
        const result = await authService.approveStepUp(req.id, 'PIN');
        onApproved(result.approvalToken);
      } catch (err) {
        setPinError(t('step_up.pin_error'));
      } finally {
        setIsLoading(false);
      }
    },
    [createRequest, authService, onApproved],
  );

  // Remote approval
  const handleRemoteApproval = useCallback(
    async (_managerSessionId: string) => {
      setIsLoading(true);
      try {
        const req = await createRequest();
        if (!req) {
          setIsLoading(false);
          return;
        }
        setRemoteStatus('sent');

        // Poll for approval status
        const pollInterval = setInterval(async () => {
          try {
            const valid = await authService.verifyStepUp(req.id);
            if (valid) {
              clearInterval(pollInterval);
              setRemoteStatus('approved');
              setIsLoading(false);
            }
          } catch {
            // Continue polling
          }
        }, 2000);

        // Timeout after 4.5 minutes
        setTimeout(() => {
          clearInterval(pollInterval);
          if (remoteStatus === 'sent') {
            setRemoteStatus('denied');
            setPinError(t('step_up.timeout_error'));
            setIsLoading(false);
          }
        }, 270000);
      } catch (err) {
        setPinError(t('step_up.send_error'));
        setIsLoading(false);
      }
    },
    [createRequest, authService, remoteStatus],
  );

  // One-time code approval
  const handleCodeSubmit = useCallback(async () => {
    if (!codeInput || codeInput.length !== 6) return;
    setIsLoading(true);
    setPinError(null);

    try {
      const req = await createRequest();
      if (!req) {
        setIsLoading(false);
        return;
      }

      // Submit the code to approve the request
      const result = await authService.approveStepUp(req.id, 'CODE');
      onApproved(result.approvalToken);
    } catch (err) {
      setPinError(t('step_up.code_error'));
    } finally {
      setIsLoading(false);
    }
  }, [codeInput, createRequest, authService, onApproved]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
    >
      <div
        className="pos-panel max-w-md w-full p-pos-xl"
        style={{ backgroundColor: 'var(--color-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <h2
          className="text-heading font-bold mb-1"
          style={{ color: 'var(--color-ink)' }}
        >
          {t('step_up.title')}
        </h2>
        <p
          className="text-body mb-1"
          style={{ color: 'var(--color-ink-muted)' }}
        >
          {t('step_up.operation_info', { operation: operationType })}
        </p>
        <p
          className="text-sm mb-4"
          style={{ color: 'var(--color-warning)' }}
        >
                  {t('step_up.expiration_label', { time: formatTime(countdown) })}
        </p>

        {/* Tab buttons */}
        <div className="flex gap-1 mb-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          {(['pin', 'remote', 'code'] as const).map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => setTab(tabKey)}
              style={{
                flex: 1,
                padding: '8px 12px',
                border: 'none',
                borderBottom: tab === tabKey ? '2px solid var(--color-primary)' : '2px solid transparent',
                backgroundColor: 'transparent',
                color: tab === tabKey ? 'var(--color-primary)' : 'var(--color-ink-muted)',
                fontWeight: tab === tabKey ? 600 : 400,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {tabKey === 'pin' && t('step_up.pin_tab')}
              {tabKey === 'remote' && t('step_up.remote_tab')}
              {tabKey === 'code' && t('step_up.code_tab')}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'pin' && (
          <PinKeypad
            length={6}
            onComplete={handlePinComplete}
            error={pinError}
            isLoading={isLoading}
            label={t('step_up.pin_label')}
          />
        )}

        {tab === 'remote' && (
          <div className="flex flex-col items-center gap-4">
            <p
              className="text-sm text-center"
              style={{ color: 'var(--color-ink-muted)' }}
            >
              {t('step_up.remote_instruction')}
            </p>

            {remoteStatus === 'sent' ? (
              <div className="text-center">
                <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
                <p style={{ color: 'var(--color-ink-muted)' }}>
                  {t('step_up.remote_waiting')}
                </p>
                <p className="text-sm" style={{ color: 'var(--color-warning)' }}>
          {t('step_up.expiration_label', { time: formatTime(countdown) })}
                </p>
              </div>
            ) : remoteStatus === 'approved' ? (
              <p style={{ color: 'var(--color-success)' }}>
                {t('step_up.remote_approved')}
              </p>
            ) : (
              <div className="w-full flex flex-col gap-2">
                {/* Ideally fetched from server */}
                <p
                  className="text-sm text-center"
                  style={{ color: 'var(--color-ink-muted)' }}
                >
                  {t('step_up.remote_no_managers')}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setRemoteStatus('sent');
                    handleRemoteApproval('');
                  }}
                  className="pos-button pos-button--primary w-full"
                  disabled={isLoading}
                >
                  {t('step_up.remote_request')}
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'code' && (
          <div className="flex flex-col items-center gap-4">
            <p
              className="text-sm text-center"
              style={{ color: 'var(--color-ink-muted)' }}
            >
              {t('step_up.code_instruction')}
            </p>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={codeInput}
              onChange={(e) =>
                setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))
              }
              placeholder="••••••"
              className="pos-input text-center text-2xl tracking-widest"
              style={{ fontVariantNumeric: 'tabular-nums', maxWidth: 200 }}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCodeSubmit()}
            />
            {pinError && (
              <p className="text-sm" style={{ color: 'var(--color-error)' }}>
                {pinError}
              </p>
            )}
            <button
              type="button"
              disabled={codeInput.length !== 6 || isLoading}
              onClick={handleCodeSubmit}
              className="pos-button pos-button--primary"
            >
              {isLoading ? t('auth.verifying') : t('step_up.code_verify')}
            </button>
          </div>
        )}

        {/* Cancel */}
        <div className="mt-4 flex justify-center">
          {remoteStatus !== 'sent' && (
            <button
              type="button"
              onClick={onCancel}
              className="pos-button pos-button--ghost"
            >
              {t('step_up.cancel_operation')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
