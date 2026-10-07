import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { AuthActionShell } from "../components/common/auth-action-shell";
import { RequestEmailForm } from "../components/common/request-email-form";
import { CheckCircleIcon, LockIcon } from "../components/icons/app-icons";
import { extractApiErrorCode, isRateLimited } from "../services/api";
import {
  AUTH_INVALID_CREDENTIALS,
  AUTH_INVALID_VERIFICATION_TOKEN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isPlausibleToken,
  requestPasswordReset,
  resetPassword,
} from "../services/account-verification";

const RESET_SCHEMA = z
  .object({
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, "tooShort")
      .max(PASSWORD_MAX_LENGTH, "tooLong"),
    confirmPassword: z.string().min(1, "required"),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "mismatch",
    path: ["confirmPassword"],
  });

type ResetFormValues = z.infer<typeof RESET_SCHEMA>;

type Outcome = "pending" | "done" | "invalid";

/**
 * Landing page for the emailed password-reset link
 * (`/reset-password?token=…`).
 *
 * SECURITY: the token is single-use and mail clients pre-fetch links, so the
 * page renders the form and POSTs only on an explicit submit. See
 * services/account-verification.ts.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [outcome, setOutcome] = useState<Outcome>("pending");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  const form = useForm<ResetFormValues>({
    resolver: zodResolver(RESET_SCHEMA),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const announce = (next: Outcome, message: string | null) => {
    setOutcome(next);
    setError(message);
    window.requestAnimationFrame(() => resultRef.current?.focus());
  };

  const handleSubmit = async (values: ResetFormValues) => {
    if (!isPlausibleToken(token)) return;
    setSubmitting(true);
    setError(null);
    try {
      await resetPassword(token, values.newPassword);
      announce("done", null);
    } catch (err) {
      if (isRateLimited(err)) {
        announce("pending", t("emailActions.rateLimited"));
      } else {
        const code = extractApiErrorCode(err);
        if (
          code === AUTH_INVALID_VERIFICATION_TOKEN ||
          code === AUTH_INVALID_CREDENTIALS
        ) {
          announce("invalid", null);
        } else {
          announce("pending", t("resetPassword.requestFailed"));
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (outcome === "done") {
    return (
      <AuthActionShell
        title={t("resetPassword.doneTitle")}
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
            {t("resetPassword.doneBody")}
          </Alert>
          {/* The server revoked every session and offline token, so this is
              the one thing the user must not be surprised by. */}
          <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
            {t("resetPassword.sessionsRevoked")}
          </Alert>
          <Button component={Link} to="/login" variant="contained" fullWidth sx={{ mt: 3 }}>
            {t("resetPassword.goToLogin")}
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
        title={token ? t("resetPassword.invalidTitle") : t("resetPassword.title")}
        subtitle={token ? undefined : t("resetPassword.subtitle")}
        icon={<LockIcon size={20} />}
      >
        <Box ref={resultRef} tabIndex={-1} role="alert" sx={{ outline: "none" }}>
          <Alert
            severity={token ? "warning" : "error"}
            variant="outlined"
            sx={{ mb: 3 }}
          >
            {token ? t("resetPassword.invalidBody") : t("resetPassword.missingToken")}
          </Alert>
        </Box>
        <RequestEmailForm
          onRequest={requestPasswordReset}
          submitLabel={t("resetPassword.requestNew")}
          acknowledgement={t("emailActions.acknowledgement")}
        />
      </AuthActionShell>
    );
  }

  if (outcome === "invalid") {
    return (
      <AuthActionShell
        title={t("resetPassword.invalidTitle")}
        icon={<LockIcon size={20} />}
      >
        <Box ref={resultRef} tabIndex={-1} role="alert" sx={{ outline: "none" }}>
          <Alert severity="warning" variant="outlined" sx={{ mb: 3 }}>
            {t("resetPassword.invalidBody")}
          </Alert>
        </Box>
        <RequestEmailForm
          onRequest={requestPasswordReset}
          submitLabel={t("resetPassword.requestNew")}
          acknowledgement={t("emailActions.acknowledgement")}
        />
      </AuthActionShell>
    );
  }

  return (
    <AuthActionShell
      title={t("resetPassword.title")}
      subtitle={t("resetPassword.subtitle")}
      icon={<LockIcon size={20} />}
    >
      <Box component="form" onSubmit={form.handleSubmit(handleSubmit)} noValidate>
        <Typography variant="body2" color="text.secondary" mb={2}>
          {t("resetPassword.confirmHint")}
        </Typography>

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

        <TextField
          label={t("resetPassword.newPassword")}
          type="password"
          fullWidth
          margin="normal"
          autoFocus
          autoComplete="new-password"
          {...form.register("newPassword")}
          error={Boolean(form.formState.errors.newPassword)}
          // Zod carries stable keys; copy resolves here so the schema stays a
          // module-level constant.
          helperText={
            form.formState.errors.newPassword
              ? t(`resetPassword.fieldError.${form.formState.errors.newPassword.message}`, {
                  min: PASSWORD_MIN_LENGTH,
                  max: PASSWORD_MAX_LENGTH,
                })
              : t("resetPassword.passwordHint", {
                  min: PASSWORD_MIN_LENGTH,
                  max: PASSWORD_MAX_LENGTH,
                })
          }
        />
        <TextField
          label={t("resetPassword.confirmPassword")}
          type="password"
          fullWidth
          margin="normal"
          autoComplete="new-password"
          {...form.register("confirmPassword")}
          error={Boolean(form.formState.errors.confirmPassword)}
          helperText={
            form.formState.errors.confirmPassword
              ? t(`resetPassword.fieldError.${form.formState.errors.confirmPassword.message}`)
              : undefined
          }
        />

        <Button
          type="submit"
          variant="contained"
          fullWidth
          size="large"
          disabled={submitting}
          startIcon={
            submitting ? <CircularProgress size={16} color="inherit" /> : undefined
          }
          sx={{ mt: 3 }}
        >
          {t("resetPassword.submit")}
        </Button>
      </Box>
    </AuthActionShell>
  );
}