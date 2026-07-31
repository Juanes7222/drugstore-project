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
import { type FC, useState, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useLocalSessionStore } from '../../../domain/auth/local-session.store';
import type { LocalUserInfo } from '../../../domain/auth/local-users';
import { loadCachedUsers } from '../../../domain/auth/local-user-cache';
import { useLoginPage } from '../../hooks/use-login-page';
import { LoginHeader } from './login-header';
import { AvatarGrid } from './avatar-grid';
import { ManualLoginForm } from './manual-login-form';
import { SelectedUserCredential } from './selected-user-credential';
import { ErrorBanner } from './error-banner';
import { TwoFactorModal } from './two-factor-modal';
import { WifiIcon } from "@/components/ui/icons";

export const LoginPage: FC = () => {
  const { t } = useTranslation();
  const session = useLocalSessionStore((s) => s.session);

  // Load cached users on mount for the avatar grid.
  // The cache is empty on first ever use (no user has logged in on this
  // device yet). In that case the selection screen shows a prompt to use
  // the manual login form instead of an empty grid.
  const [cachedUsers, setCachedUsers] = useState<LocalUserInfo[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadCachedUsers()
      .then((users) => {
        if (!cancelled) setCachedUsers(users);
      })
      .catch(() => {
        if (!cancelled) setCachedUsers([]);
      });
    return () => { cancelled = true; };
  }, []);

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
    localUsers,
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

  // Merge local PGlite users into the cached user list for the avatar grid.
  // Local users take precedence over cached server users with the same id.
  // When cache hasn't loaded yet (cachedUsers === null), mergedUsers is also null.
  const mergedUsers = useMemo<LocalUserInfo[] | null>(() => {
    if (cachedUsers === null) return null;

    // Build a map keyed by id — local entries overwrite cached ones,
    // giving local users precedence when ids collide.
    const userMap = new Map<string, LocalUserInfo>();
    for (const u of cachedUsers) {
      userMap.set(u.id, u);
    }
    for (const u of localUsers) {
      userMap.set(u.id, u);
    }

    return Array.from(userMap.values());
  }, [cachedUsers, localUsers]);

  // Track which user ids come from local PGlite so AvatarGrid can
  // show a subtle "local" indicator on those cards.
  const localUserIds = useMemo<Set<string>>(
    () => new Set(localUsers.map((u) => u.id)),
    [localUsers],
  );

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
  // If cachedUsers is null the cache is still loading; if mergedUsers is
  // an empty array no user exists (neither cached nor local), so default
  // to the manual form so the cashier can log in via email/password.
  const showManual = showManualInput || (mergedUsers !== null && mergedUsers.length === 0 && !selectedUser);
  const contentKey = showManual
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
              <WifiIcon size={14} strokeWidth={1.2} className="shrink-0" />
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
              {/* Loading cache — neither grid nor form ready yet */}
              {cachedUsers === null && (
                <div className="flex items-center justify-center py-8">
                  <span
                    className="text-sm"
                    style={{ color: 'var(--color-ink-muted)' }}
                  >
                    {t('common.loading')}
                  </span>
                </div>
              )}

              {contentKey === 'selection' && mergedUsers !== null && (
                <AvatarGrid
                  users={mergedUsers}
                  localUserIds={localUserIds}
                  onSelect={handleUserSelect}
                  onOtherAccount={() => setShowManualInput(true)}
                />
              )}

              {contentKey === 'manual' && cachedUsers !== null && (
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
