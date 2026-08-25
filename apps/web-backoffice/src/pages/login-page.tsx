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
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { BrandMark } from "../components/common/brand-mark";
import { homePathFor, useAuthStore } from "../hooks/use-auth";
import type { AuthUser } from "../types/backoffice";
import {
  ArrowUpRightIcon,
  CheckCircleIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
} from "../components/icons/app-icons";
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

/** Modules shown on the day-summary ticket; reuses nav labels so the
 * vocabulary matches what the user will see after signing in. */
function ReceiptStub() {
  const { t } = useTranslation();
  const rows = [
    t("nav.sales"),
    t("nav.cashShifts"),
    t("nav.inventoryAlerts"),
    t("nav.fiscal"),
    t("nav.sessions"),
  ];

  return (
    <Box className="animate-fade-up" sx={{ animationDelay: "120ms", width: 296 }}>
      <Box
        sx={{
          bgcolor: "#FFFFFF",
          borderRadius: "10px 10px 0 0",
          px: 2.5,
          pt: 2,
          pb: 1.5,
          boxShadow: "0 18px 44px rgba(3, 25, 32, 0.4)",
        }}
      >
        <Typography
          component="p"
          m={0}
          mb={1.25}
          sx={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#64748B",
          }}
        >
          {t("login.receiptTitle")}
        </Typography>
        {rows.map((label) => (
          <Box key={label} display="flex" alignItems="baseline" py={0.5}>
            <Typography
              component="span"
              m={0}
              sx={{ fontSize: 12.5, fontWeight: 600, color: "#334155", whiteSpace: "nowrap" }}
            >
              {label}
            </Typography>
            <Box flex={1} mx={1} sx={{ borderBottom: "2px dotted #CBD5E1", transform: "translateY(-3px)" }} />
            <Box
              component="span"
              sx={{ color: "#15803D", display: "flex", flexShrink: 0, transform: "translateY(3px)" }}
            >
              <CheckCircleIcon size={15} />
            </Box>
          </Box>
        ))}
      </Box>
      {/* Torn perforation: white strip with circular bites cut out along its
          top edge, revealing the teal panel behind it. */}
      <Box
        aria-hidden
        sx={{
          height: 12,
          backgroundImage:
            "radial-gradient(circle at 7px 0px, transparent 7px, #FFFFFF 7.5px)",
          backgroundSize: "16px 12px",
          backgroundRepeat: "repeat-x",
        }}
      />
    </Box>
  );
}

function BrandPanel() {
  const { t } = useTranslation();

  return (
    <Box
      sx={{
        display: { xs: "block", md: "flex" },
        flexDirection: "column",
        justifyContent: "center",
        px: { xs: 3, md: 8 },
        py: { xs: 5, md: 0 },
        color: "#FFFFFF",
        background:
          "linear-gradient(165deg, #083944 0%, #0E7490 62%, #1094A6 100%)",
      }}
    >
      <Box sx={{ maxWidth: 460, mx: { xs: "auto", md: 0 } }}>
        <Box display="flex" alignItems="center" gap={1.5} className="animate-fade-up">
          <BrandMark size={34} />
          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: alpha("#FFFFFF", 0.82),
            }}
          >
            {t("common.appName")}
          </Typography>
        </Box>

        <Typography
          component="h2"
          className="animate-fade-up"
          sx={{
            mt: { xs: 1.5, md: 4 },
            fontSize: { xs: 26, md: 34 },
            lineHeight: 1.15,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            animationDelay: "60ms",
          }}
        >
          {t("login.headline")}
        </Typography>

        <Typography
          component="p"
          m={0}
          className="animate-fade-up"
          sx={{
            mt: 1.5,
            fontSize: 15,
            lineHeight: 1.6,
            color: alpha("#FFFFFF", 0.78),
            animationDelay: "90ms",
          }}
        >
          {t("login.heroSub")}
        </Typography>

        <Box mt={{ xs: 0, md: 5 }} display={{ xs: "none", md: "block" }}>
          <ReceiptStub />
        </Box>
      </Box>
    </Box>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  // Account creation (plan selection + Wompi checkout) lives on the public
  // site; when no landing URL is configured the entry point stays hidden.
  const landingUrl = import.meta.env.VITE_LANDING_URL?.replace(/\/$/, "");
  const signupUrl = landingUrl ? `${landingUrl}/#planes` : null;
  const setSession = useAuthStore((state) => state.setSession);
  const storedUser = useAuthStore((state) => state.user);
  const hasSession = useAuthStore((state) => Boolean(state.accessToken));

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

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
    return <Navigate to={homePathFor(storedUser)} replace />;
  }

  // Return to the originally requested route when present; otherwise land
  // each account on its own surface (platform owners → /admin).
  const redirectAfterLogin = (user: AuthUser) => {
    const target =
      (location.state as { from?: { pathname?: string } } | null)?.from
        ?.pathname ?? homePathFor(user);
    navigate(target, { replace: true });
  };

  const trackCapsLock = (event: React.KeyboardEvent) => {
    setCapsLockOn(event.getModifierState?.("CapsLock") ?? false);
  };

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
      redirectAfterLogin(result.user);
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
      redirectAfterLogin(result.user);
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
      redirectAfterLogin(result.user);
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
    <Box sx={{ display: { md: "flex" }, minHeight: "100vh", bgcolor: "background.default" }}>
      <BrandPanel />

      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        sx={{
          flex: 1,
          px: 2,
          py: { xs: 4, md: 6 },
        }}
      >
        <Card
          variant="outlined"
          className="animate-fade-up"
          sx={{ width: "100%", maxWidth: 408 }}
        >
          <Box px={{ xs: 3, sm: 4 }} py={{ xs: 3.5, sm: 4 }}>
            <Typography variant="h5" component="h1" fontWeight={700} sx={{ letterSpacing: "-0.02em" }}>
              {challengeToken ? t("login.twoFactorTitle") : t("login.title")}
            </Typography>
            <Typography variant="body2" color="text.secondary" mt={0.5} mb={3}>
              {challengeToken ? t("login.twoFactorHint") : t("login.subtitle")}
            </Typography>

            {/* Assertive live region so screen readers announce failures. */}
            <Box aria-live="assertive">
              {error ? (
                <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              ) : null}
            </Box>

            {challengeToken ? (
              <Box
                component="form"
                onSubmit={twoFactorForm.handleSubmit(handleTwoFactor)}
                noValidate
              >
                <TextField
                  label={t("login.totpCode")}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  fullWidth
                  margin="normal"
                  autoFocus
                  {...twoFactorForm.register("totpCode")}
                  error={Boolean(twoFactorForm.formState.errors.totpCode)}
                  helperText={twoFactorForm.formState.errors.totpCode?.message}
                />
                <TextField
                  label={t("login.backupCode")}
                  autoComplete="off"
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
                  startIcon={
                    submitting ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : undefined
                  }
                  sx={{ mt: 3 }}
                >
                  {t("login.twoFactorSubmit")}
                </Button>
                <Button
                  type="button"
                  variant="text"
                  fullWidth
                  disabled={submitting}
                  onClick={() => setChallengeToken(null)}
                  sx={{ mt: 1 }}
                >
                  {t("common.cancel")}
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
                    type={showSecret ? "text" : "password"}
                    fullWidth
                    margin="normal"
                    autoComplete="current-password"
                    onKeyDown={trackCapsLock}
                    onKeyUp={trackCapsLock}
                    {...loginForm.register("secret", {
                      onBlur: () => setCapsLockOn(false),
                    })}
                    error={Boolean(loginForm.formState.errors.secret)}
                    helperText={
                      loginForm.formState.errors.secret?.message ??
                      (capsLockOn ? t("login.capsLock") : undefined)
                    }
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            size="small"
                            edge="end"
                            onClick={() => setShowSecret((v) => !v)}
                            aria-label={
                              showSecret
                                ? t("login.hideSecret")
                                : t("login.showSecret")
                            }
                          >
                            {showSecret ? (
                              <EyeOffIcon size={17} />
                            ) : (
                              <EyeIcon size={17} />
                            )}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    fullWidth
                    size="large"
                    disabled={submitting}
                    startIcon={
                      submitting ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : undefined
                    }
                    sx={{ mt: 3 }}
                  >
                    {t("login.submit")}
                  </Button>
                </Box>

                <Divider sx={{ my: 3 }}>
                  <Typography variant="body2" color="text.secondary" px={1}>
                    {t("login.googleDivider")}
                  </Typography>
                </Divider>

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
                    <CircularProgress size={20} />
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

                {signupUrl ? (
                  <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    gap={0.5}
                    mt={3}
                  >
                    <Typography variant="body2" color="text.secondary">
                      {t("login.noAccount")}
                    </Typography>
                    <Button
                      component="a"
                      href={signupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      variant="text"
                      size="small"
                      endIcon={<ArrowUpRightIcon size={14} />}
                      sx={{ textTransform: "none", fontWeight: 700 }}
                    >
                      {t("login.createAccount")}
                    </Button>
                  </Box>
                ) : null}
              </Box>
            )}

            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              gap={0.75}
              mt={4}
              sx={{ color: "text.disabled" }}
            >
              <LockIcon size={13} aria-hidden />
              <Typography variant="caption" sx={{ fontSize: 11 }}>
                {t("login.securityNote")}
              </Typography>
            </Box>
          </Box>
        </Card>
      </Box>
    </Box>
  );
}
