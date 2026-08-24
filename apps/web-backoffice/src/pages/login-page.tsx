import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import axios from "axios";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GoogleAuthProvider, getIdToken, signInWithPopup } from "firebase/auth";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { BrandMark } from "../components/common/brand-mark";
import { useAuthStore } from "../hooks/use-auth";
import {
  completeTwoFactor,
  fetchFirebaseConfig,
  login,
  loginWithFirebase,
} from "../services/auth";
import { getFirebaseAuth, isFirebaseConfigured } from "../services/firebase";

const LOGIN_SCHEMA = z.object({
  identifier: z.string().min(1),
  secret: z.string().min(1),
});

type LoginFormValues = z.infer<typeof LOGIN_SCHEMA>;

const TWO_FACTOR_SCHEMA = z
  .object({
    totpCode: z.string().optional(),
    backupCode: z.string().optional(),
  })
  .refine((v) => v.totpCode || v.backupCode, { message: "required" });

type TwoFactorValues = z.infer<typeof TWO_FACTOR_SCHEMA>;

function GoogleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((state) => state.setSession);
  const hasSession = useAuthStore((state) => Boolean(state.accessToken));

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(LOGIN_SCHEMA),
    defaultValues: {
      identifier: "",
      secret: "",
    },
  });

  const twoFactorForm = useForm<TwoFactorValues>({
    resolver: zodResolver(TWO_FACTOR_SCHEMA),
    defaultValues: { totpCode: "", backupCode: "" },
  });

  if (hasSession) {
    return <Navigate to="/dashboard" replace />;
  }

  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname ?? "/dashboard";

  const handleLogin = async (values: LoginFormValues) => {
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(values);
      if (result.requiresTwoFactor && result.challengeToken) {
        setChallengeToken(result.challengeToken);
        return;
      }
      setSession(
        result.accessToken,
        result.refreshToken,
        result.expiresAt,
        result.user,
      );
      navigate(from, { replace: true });
    } catch {
      setError(t("login.invalid"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleTwoFactor = async (values: TwoFactorValues) => {
    if (!challengeToken) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await completeTwoFactor({
        challengeToken,
        totpCode: values.totpCode || undefined,
        backupCode: values.backupCode || undefined,
      });
      setSession(
        result.accessToken,
        result.refreshToken,
        result.expiresAt,
        result.user,
      );
      navigate(from, { replace: true });
    } catch {
      setError(t("login.twoFactorInvalid"));
    } finally {
      setSubmitting(false);
    }
  };

  const mapGoogleError = (error: unknown): string | null => {
    const code = (error as { code?: unknown }).code;
    // User closing the popup is not an error worth surfacing.
    if (
      typeof code === "string" &&
      (code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request")
    ) {
      return null;
    }
    if (axios.isAxiosError(error)) {
      const errorCode = (
        error.response?.data as { errorCode?: string } | undefined
      )?.errorCode;
      switch (errorCode) {
        case "AUTH_ACCOUNT_INACTIVE":
          return t("login.googlePending");
        case "AUTH_FIREBASE_EMAIL_CONFLICT":
          return t("login.googleConflict");
        case "AUTH_FIREBASE_NOT_CONFIGURED":
          return t("login.googleUnavailable");
        case "FORBIDDEN":
          return t("login.googleDomainDenied");
      }
    }
    return t("login.googleFailed");
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setGoogleSubmitting(true);
    try {
      const config = await fetchFirebaseConfig();
      if (!isFirebaseConfigured(config)) {
        setError(t("login.googleUnavailable"));
        return;
      }
      const auth = getFirebaseAuth(config);
      const credential = await signInWithPopup(auth, new GoogleAuthProvider());
      const idToken = await getIdToken(credential.user);
      const result = await loginWithFirebase(idToken);
      if (result.requiresTwoFactor && result.challengeToken) {
        setChallengeToken(result.challengeToken);
        return;
      }
      setSession(
        result.accessToken,
        result.refreshToken,
        result.expiresAt,
        result.user,
      );
      navigate(from, { replace: true });
    } catch (err) {
      const mapped = mapGoogleError(err);
      if (mapped) {
        setError(mapped);
      }
    } finally {
      setGoogleSubmitting(false);
    }
  };

  return (
    <Box
      display="flex"
      alignItems="center"
      justifyContent="center"
      minHeight="100vh"
      bgcolor="background.default"
      px={2}
    >
      <Card variant="outlined" sx={{ maxWidth: 420, width: "100%" }}>
        <CardContent sx={{ p: 4 }}>
          <Box display="flex" alignItems="center" gap={1.5} mb={1}>
            <BrandMark size={36} />
            <Typography variant="h5" component="h1" fontWeight={700}>
              {t("common.appName")}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" mb={3}>
            {t("login.subtitle")}
          </Typography>

          {error ? (
            <Alert severity="error" sx={{ mb: 2 }} role="alert">
              {error}
            </Alert>
          ) : null}

          {challengeToken ? (
            <Box
              component="form"
              onSubmit={twoFactorForm.handleSubmit(handleTwoFactor)}
              noValidate
            >
              <Typography variant="h6" mb={2}>
                {t("login.twoFactorTitle")}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                {t("login.twoFactorHint")}
              </Typography>
              <TextField
                label={t("login.totpCode")}
                inputMode="numeric"
                fullWidth
                margin="normal"
                autoFocus
                {...twoFactorForm.register("totpCode")}
                error={Boolean(twoFactorForm.formState.errors.totpCode)}
                helperText={twoFactorForm.formState.errors.totpCode?.message}
              />
              <TextField
                label={t("login.backupCode")}
                fullWidth
                margin="normal"
                {...twoFactorForm.register("backupCode")}
              />
              <Button
                type="submit"
                variant="contained"
                fullWidth
                size="large"
                disabled={submitting}
                sx={{ mt: 3 }}
              >
                {submitting ? (
                  <CircularProgress size={22} color="inherit" />
                ) : (
                  t("login.twoFactorSubmit")
                )}
              </Button>
            </Box>
          ) : (
            <Box>
              <Box
                component="form"
                onSubmit={loginForm.handleSubmit(handleLogin)}
                noValidate
              >
                <TextField
                  label={t("login.identifier")}
                  fullWidth
                  margin="normal"
                  autoFocus
                  autoComplete="username"
                  {...loginForm.register("identifier")}
                  error={Boolean(loginForm.formState.errors.identifier)}
                  helperText={loginForm.formState.errors.identifier?.message}
                />
                <TextField
                  label={t("login.secret")}
                  type="password"
                  fullWidth
                  margin="normal"
                  autoComplete="current-password"
                  {...loginForm.register("secret")}
                  error={Boolean(loginForm.formState.errors.secret)}
                  helperText={loginForm.formState.errors.secret?.message}
                />
                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  size="large"
                  disabled={submitting}
                  sx={{ mt: 3 }}
                >
                  {submitting ? (
                    <CircularProgress size={22} color="inherit" />
                  ) : (
                    t("login.submit")
                  )}
                </Button>
              </Box>

              <Box
                display="flex"
                alignItems="center"
                gap={1.5}
                my={3}
                role="separator"
                aria-label={t("login.googleDivider")}
              >
                <Divider sx={{ flex: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  {t("login.googleDivider")}
                </Typography>
                <Divider sx={{ flex: 1 }} />
              </Box>

              <Button
                type="button"
                variant="outlined"
                fullWidth
                size="large"
                startIcon={<GoogleIcon />}
                disabled={submitting || googleSubmitting}
                onClick={handleGoogleLogin}
                aria-label={t("login.google")}
              >
                {googleSubmitting ? (
                  <CircularProgress size={22} />
                ) : (
                  t("login.google")
                )}
              </Button>
              <Typography
                variant="caption"
                color="text.secondary"
                align="center"
                display="block"
                mt={1.5}
              >
                {t("login.googleHint")}
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
