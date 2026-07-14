/**
 * Login page — first screen after activation.
 *
 * Thin composition that wires the useLoginPage hook to five
 * presentational child components.
 */
import { type FC } from 'react';
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
  } = useLoginPage();

  // Already logged in — redirect handled by the hook; return null to avoid
  // rendering a flash of the login page while the dispatch is processed.
  if (session) return null;

  // 2FA modal takes over the full screen
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

  return (
    <div
      className="flex h-screen flex-col items-center justify-center p-pos-xl"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      <div className="w-full max-w-sm flex flex-col items-center gap-pos-lg">
        <LoginHeader />

        {!showManualInput && (
          <AvatarGrid
            users={PLACEHOLDER_USERS}
            selectedUserId={selectedUser?.id ?? null}
            onSelect={handleUserSelect}
            onOtherAccount={() => setShowManualInput(true)}
          />
        )}

        {showManualInput && (
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

        {selectedUser && !showManualInput && (
          <SelectedUserCredential
            user={selectedUser}
            password={password}
            error={error}
            isLoading={isLoading}
            countdown={countdown}
            onPasswordChange={setPassword}
            onPinComplete={handlePinComplete}
            onPasswordSubmit={handlePasswordLogin}
            onChangeUser={() => setSelectedUser(null)}
            onForgotPassword={handleForgotPassword}
          />
        )}

        {error && !selectedUser && (
          <ErrorBanner message={error} />
        )}
      </div>
    </div>
  );
};
