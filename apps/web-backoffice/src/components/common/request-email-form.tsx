import { useState } from "react";
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
import { isRateLimited } from "../../services/api";

const EMAIL_SCHEMA = z.object({
  email: z
    .string()
    .min(1, "required")
    .email("invalid")
    .max(254, "tooLong"),
});

type EmailFormValues = z.infer<typeof EMAIL_SCHEMA>;

interface RequestEmailFormProps {
  /**
   * Performs the POST. Receives the trimmed address and is only ever called
   * from an explicit submit, never on mount. The resolved value is ignored on
   * purpose: it carries no information about whether the address exists.
   */
  onRequest: (email: string) => Promise<unknown>;
  submitLabel: string;
  /** Copy describing what happens next once the request is accepted. */
  acknowledgement: string;
}

/**
 * Asks for an email address and re-issues a verification or reset link.
 *
 * Both server endpoints answer identically whether or not the address belongs
 * to an account, so this component renders ONE acknowledgement regardless of
 * the outcome and never branches on it — otherwise the page itself becomes an
 * account-enumeration oracle.
 */
export function RequestEmailForm({
  onRequest,
  submitLabel,
  acknowledgement,
}: RequestEmailFormProps) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<EmailFormValues>({
    resolver: zodResolver(EMAIL_SCHEMA),
    defaultValues: { email: "" },
  });

  const handleSubmit = async (values: EmailFormValues) => {
    setError(null);
    setSubmitting(true);
    try {
      await onRequest(values.email.trim());
      setSent(true);
    } catch (err) {
      // A 429 is the throttler, not a bad address: tell the user to wait
      // instead of implying their input was wrong.
      if (isRateLimited(err)) {
        setError(t("emailActions.rateLimited"));
      } else {
        setError(t("emailActions.requestFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box component="form" onSubmit={form.handleSubmit(handleSubmit)} noValidate>
      <Typography variant="body2" color="text.secondary" mb={2}>
        {t("emailActions.promptForEmail")}
      </Typography>

      <Box aria-live="assertive">
        {error ? (
          <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
      </Box>

      {sent ? (
        <Alert severity="success" variant="outlined">
          {acknowledgement}
        </Alert>
      ) : (
        <>
          <TextField
            label={t("emailActions.emailLabel")}
            type="email"
            fullWidth
            margin="normal"
            autoFocus
            autoComplete="email"
            {...form.register("email")}
            error={Boolean(form.formState.errors.email)}
            // Zod issues carry stable keys; copy is resolved here so the
            // schema stays a module-level constant.
            helperText={
              form.formState.errors.email
                ? t(`emailActions.emailError.${form.formState.errors.email.message}`)
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
            {submitLabel}
          </Button>
        </>
      )}
    </Box>
  );
}