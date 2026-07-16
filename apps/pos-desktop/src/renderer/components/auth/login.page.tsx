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
 */
import { type FC } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import { PLACEHOLDER_USERS } from "../../../domain/auth/local-users";
import { useLoginPage } from "../../hooks/use-login-page";
import { LoginHeader } from "./login-header";
import { AvatarGrid } from "./avatar-grid";
import { ManualLoginForm } from "./manual-login-form";
import { SelectedUserCredential } from "./selected-user-credential";
import { ErrorBanner } from "./error-banner";
import { TwoFactorModal } from "./two-factor-modal";

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

  // Already logged in — redirect handled by the hook
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

  // Determine which content to show — memoized key for AnimatePresence
  const contentKey = showManualInput
    ? "manual"
    : selectedUser
      ? `credential-${selectedUser.id}`
      : "selection";

  return (
    <div
      className="flex h-screen flex-col items-center justify-center overflow-hidden"
      style={{ backgroundColor: "var(--color-surface)" }}
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
            backgroundColor: "var(--color-pharma)",
            filter: "blur(80px)",
          }}
        />
        {/* Subtle bottom-left gradient blob */}
        <div
          className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full opacity-[0.02]"
          style={{
            backgroundColor: "var(--color-restrict)",
            filter: "blur(80px)",
          }}
        />
      </div>

      {/* Main content */}
      <div className="relative z-10 w-full max-w-sm flex flex-col items-center gap-5 px-pos-lg">
        {/* Header — always visible */}
        <LoginHeader />

        {/* Animated content area */}
        <div className="w-full min-h-[320px] flex flex-col items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={contentKey}
              className="w-full"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            >
              {contentKey === "selection" && (
                <AvatarGrid
                  users={PLACEHOLDER_USERS}
                  onSelect={handleUserSelect}
                  onOtherAccount={() => setShowManualInput(true)}
                />
              )}

              {contentKey === "manual" && (
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

              {selectedUser && contentKey.startsWith("credential") && (
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
          color: "color-mix(in srgb, var(--color-ink) 30%, transparent)",
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
