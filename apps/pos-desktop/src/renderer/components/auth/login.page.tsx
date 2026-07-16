/**
 * Login page — two-step flow with animated transitions.
 *
 * Step 1 — User Selection (Netflix-style):
 *   Shows a grid of available user profiles with staggered entrance
 *   animation. The cashier taps their profile to proceed.
 *
 * Step 2 — Credential Entry:
 *   The selected user's avatar and name animate in, followed by the
 *   appropriate input (PIN keypad for Cashier/Manager, password for
 *   Owner/Admin). A "Change user" link returns to Step 1.
 *
 * Both steps share a common background, header, and 2FA overlay.
 * When offline, the flow adapts: 2FA is bypassed and an informative
 * message is shown.
 */
import { type FC } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useLocalSessionStore } from '../../../domain/auth/local-session.store';
import { PLACEHOLDER_USERS } from '../../../domain/auth/local-users';
import { useLoginPage } from '../../hooks/use-login-page';
import { LoginHeader } from './login-header';
import { AvatarGrid } from './avatar-grid';
import { ManualLoginForm } from './manual-login-form';
import { SelectedUserCredential } from './selected-user-credential';
import { ErrorBanner } from './error-banner';
import { TwoFactorModal } from './two-factor-modal';

export const LoginPage: FC = () => {
  const { t } = useTranslation();
  const session = useLocalSessionStore((s) => s.session);
  const {
    selectedUser,
    showManualInput,
    identifier,
    password,
    error,
    isLoading,
    requiresTwoFactor,
    challengeToken,
    countdown,
    authService,
    handleUserSelect,
    handlePinComplete,
    handlePasswordLogin,
    handleTwoFactorComplete,
    handleTwoFactorCancel,
    handleForgotPassword,
    setShowManualInput,
    setIdentifier,
    setPassword,
    setSelectedUser,

    // Offline extensions
    isOfflineMode,
    offlineErrorMessage,
    offlineLoginSkipped2fa,
  } = useLoginPage();

  // Already logged in — redirect handled by the hook
  if (session) return null;

  // 2FA modal takes over the full screen (only shown when online)
  if (requiresTwoFactor && challengeToken) {
    return (
      <TwoFactorModal
        challengeToken={challengeToken}
        authService={authService}
        onComplete={handleTwoFactorComplete}
        onCancel={handleTwoFactorCancel}
      />
    );
  }

  // Determine which content to show — memoized key for AnimatePresence
  const contentKey = showManualInput
    ? 'manual'
    : selectedUser
      ? `credential-${selectedUser.id}`
      : 'selection';

  return (
    <div
      className="flex h-screen flex-col items-center justify-center overflow-hidden"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      {/* Background decorative elements */}
      <div
        className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden"
        aria-hidden="true"
      >
        {/* Subtle top-right gradient blob */}
        <div
          className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-[0.03]"
          style={{
            backgroundColor: 'var(--color-pharma)',
            filter: 'blur(80px)',
          }}
        />
        {/* Subtle bottom-left gradient blob */}
        <div
          className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full opacity-[0.02]"
          style={{
            backgroundColor: 'var(--color-restrict)',
            filter: 'blur(80px)',
          }}
        />
      </div>

      {/* Main content */}
      <div className="relative z-10 w-full max-w-sm flex flex-col items-center gap-5 px-pos-lg">
        {/* Header — always visible */}
        <LoginHeader />

        {/* Offline mode indicator */}
        <AnimatePresence>
          {isOfflineMode && (
            <motion.div
              className="w-full px-3 py-2 rounded-lg text-sm flex items-center gap-2"
              style={{
                backgroundColor: 'var(--color-offline-bg, #FEF3C7)',
                color: 'var(--color-warning-text, #92400E)',
                border: '1px solid var(--color-warning-border, #F59E0B)',
              }}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
                className="shrink-0"
              >
                <path
                  d="M1 10.5a5 5 0 0 1 7.5-4.3m-3 8.3A5 5 0 0 1 8 3c2.1 0 3.9 1.3 4.7 3.1M13 13a3 3 0 1 0-6 0m6 0a3 3 0 0 0-6 0"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>
                {t(
                  'offline_login.banner',
                  'Sin conexión - el inicio de sesión usará credenciales locales.',
                )}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 2FA skipped notification */}
        <AnimatePresence>
          {offlineLoginSkipped2fa && (
            <motion.div
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{
                backgroundColor: 'rgba(59, 130, 246, 0.08)',
                color: '#1D4ED8',
                border: '1px solid rgba(59, 130, 246, 0.2)',
              }}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {t(
                'offline_login.skipped_2fa_info',
                'Estás sin conexión. El 2FA se requerirá cuando vuelvas a tener internet.',
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Animated content area */}
        <div className="w-full min-h-80 flex flex-col items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={contentKey}
              className="w-full"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            >
              {contentKey === 'selection' && (
                <AvatarGrid
                  users={PLACEHOLDER_USERS}
                  onSelect={handleUserSelect}
                  onOtherAccount={() => setShowManualInput(true)}
                />
              )}

              {contentKey === 'manual' && (
                <ManualLoginForm
                  identifier={identifier}
                  password={password}
                  isLoading={isLoading}
                  onIdentifierChange={setIdentifier}
                  onPasswordChange={setPassword}
                  onSubmit={handlePasswordLogin}
                  onBack={() => setShowManualInput(false)}
                />
              )}

              {selectedUser && contentKey.startsWith('credential') && (
                <SelectedUserCredential
                  user={selectedUser}
                  password={password}
                  error={error || offlineErrorMessage}
                  isLoading={isLoading}
                  countdown={countdown}
                  onPasswordChange={setPassword}
                  onPinComplete={handlePinComplete}
                  onPasswordSubmit={handlePasswordLogin}
                  onChangeUser={() => setSelectedUser(null)}
                  onForgotPassword={handleForgotPassword}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Global error (shown when no user is selected) */}
        <AnimatePresence>
          {error && !selectedUser && !showManualInput && (
            <ErrorBanner message={error} />
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <motion.p
        className="absolute bottom-6 text-caption"
        style={{
          color: 'color-mix(in srgb, var(--color-ink) 30%, transparent)',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.5 }}
      >
        Pharmacy POS v1.0
      </motion.p>
    </div>
  );
};
