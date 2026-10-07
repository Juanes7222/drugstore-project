import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { AuthActionShell } from "../components/common/auth-action-shell";
import { RequestEmailForm } from "../components/common/request-email-form";
import { CheckCircleIcon, VerifiedIcon } from "../components/icons/app-icons";
import { extractApiErrorCode, isRateLimited } from "../services/api";
import {
  AUTH_INVALID_CREDENTIALS,
  AUTH_INVALID_VERIFICATION_TOKEN,
  isPlausibleToken,
  resendVerificationEmail,
  verifyEmailToken,
} from "../services/account-verification";

type Outcome = "pending" | "verified" | "invalid";

/**
 * Landing page for the emailed verification link (`/verify-email?token=…`).
 *
 * SECURITY: the token is single-use, and mail clients and security scanners
 * pre-fetch every link in a message. This page therefore NEVER calls
 * `verifyEmailToken` on mount or from an effect — it renders a confirm button
 * and posts only when the user submits. See services/account-verification.ts.
 */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [outcome, setOutcome] = useState<Outcome>("pending");
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  // Focus the outcome region so screen readers announce the result of the
  // click that just happened, instead of leaving focus on a stale button.
  const announce = (next: Outcome, message: string | null, email?: string) => {
    setOutcome(next);
    setError(message);
    if (email !== undefined) setVerifiedEmail(email);
    window.requestAnimationFrame(() => resultRef.current?.focus());
  };

  const handleConfirm = async () => {
    if (!isPlausibleToken(token)) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await verifyEmailToken(token);
      announce("verified", null, result.email);
    } catch (err) {
      if (isRateLimited(err)) {
        announce("pending", t("emailActions.rateLimited"));
      } else {
        const code = extractApiErrorCode(err);
        // Unknown, already used, expired, or issued for a stale address all
        // collapse into one state: the remedy is identical for all of them.
        if (
          code === AUTH_INVALID_VERIFICATION_TOKEN ||
          code === AUTH_INVALID_CREDENTIALS
        ) {
          announce("invalid", null);
        } else {
          announce("pending", t("emailActions.requestFailed"));
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (outcome === "verified") {
    return (
      <AuthActionShell
        title={t("verifyEmail.verifiedTitle")}
        icon={<CheckCircleIcon size={22} />}
      >
        <Box
          ref={resultRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          sx={{ outline: "none" }}
        >
          <Alert severity="success" variant="outlined">
            {t("verifyEmail.verifiedBody", {
              email: verifiedEmail ?? "",
            })}
          </Alert>
          <Typography variant="body2" color="text.secondary" mt={2}>
            {t("verifyEmail.verifiedNext")}
          </Typography>
          <Button component={Link} to="/login" variant="contained" fullWidth sx={{ mt: 3 }}>
            {t("verifyEmail.goToLogin")}
          </Button>
        </Box>
      </AuthActionShell>
    );
  }

  // A truncated or mangled token is shown as the same invalid-link state the
  // server would produce, without spending a request on a call that can only
  // return 400.
  if (!isPlausibleToken(token)) {
    return (
      <AuthActionShell
        title={token ? t("verifyEmail.invalidTitle") : t("verifyEmail.title")}
        subtitle={token ? undefined : t("verifyEmail.subtitle")}
        icon={token ? <VerifiedIcon size={22} /> : undefined}
      >
        <Box
          ref={resultRef}
          tabIndex={-1}
          role="alert"
          sx={{ outline: "none" }}
        >
          <Alert
            severity={token ? "warning" : "error"}
            variant="outlined"
            sx={{ mb: 3 }}
          >
            {token ? t("verifyEmail.invalidBody") : t("verifyEmail.missingToken")}
          </Alert>
        </Box>
        <RequestEmailForm
          onRequest={resendVerificationEmail}
          submitLabel={t("verifyEmail.requestNew")}
          acknowledgement={t("emailActions.acknowledgement")}
        />
      </AuthActionShell>
    );
  }

  if (outcome === "invalid") {
    return (
      <AuthActionShell
        title={t("verifyEmail.invalidTitle")}
        icon={<VerifiedIcon size={22} />}
      >
        <Box ref={resultRef} tabIndex={-1} role="alert" sx={{ outline: "none" }}>
          <Alert severity="warning" variant="outlined" sx={{ mb: 3 }}>
            {t("verifyEmail.invalidBody")}
          </Alert>
        </Box>
        <RequestEmailForm
          onRequest={resendVerificationEmail}
          submitLabel={t("verifyEmail.requestNew")}
          acknowledgement={t("emailActions.acknowledgement")}
        />
      </AuthActionShell>
    );
  }

  return (
    <AuthActionShell
      title={t("verifyEmail.title")}
      subtitle={t("verifyEmail.subtitle")}
      icon={<VerifiedIcon size={22} />}
    >
      {/* Real form + submit button: Enter works and the control is announced
          as the actionable element it is. */}
      <Box
        component="form"
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          void handleConfirm();
        }}
        noValidate
      >
        <Typography variant="body2" color="text.secondary" mb={2}>
          {t("verifyEmail.confirmHint")}
        </Typography>

        {/* Same region as the terminal states so a retryable failure (429,
            network) still moves focus and is announced. */}
        <Box
          ref={resultRef}
          tabIndex={-1}
          aria-live="assertive"
          sx={{ outline: "none" }}
        >
          {error ? (
            <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : null}
        </Box>

        <Button
          type="submit"
          variant="contained"
          fullWidth
          size="large"
          disabled={submitting}
          startIcon={
            submitting ? <CircularProgress size={16} color="inherit" /> : undefined
          }
        >
          {t("verifyEmail.confirm")}
        </Button>
      </Box>
    </AuthActionShell>
  );
}