import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import MedicalServicesIcon from '@mui/icons-material/MedicalServices';
import { useAuthStore } from '../hooks/use-auth';
import { completeTwoFactor, login } from '../services/auth';

const LOGIN_SCHEMA = z.object({
  identifier: z.string().min(1),
  secret: z.string().min(1),
  workstationId: z.string().min(1),
});

type LoginFormValues = z.infer<typeof LOGIN_SCHEMA>;

const TWO_FACTOR_SCHEMA = z
  .object({
    totpCode: z.string().optional(),
    backupCode: z.string().optional(),
  })
  .refine((v) => v.totpCode || v.backupCode, { message: 'required' });

type TwoFactorValues = z.infer<typeof TWO_FACTOR_SCHEMA>;

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((state) => state.setSession);
  const hasSession = useAuthStore((state) => Boolean(state.accessToken));

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(LOGIN_SCHEMA),
    defaultValues: { identifier: '', secret: '', workstationId: 'ws_principal' },
  });

  const twoFactorForm = useForm<TwoFactorValues>({
    resolver: zodResolver(TWO_FACTOR_SCHEMA),
    defaultValues: { totpCode: '', backupCode: '' },
  });

  if (hasSession) {
    return <Navigate to="/dashboard" replace />;
  }

  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname ?? '/dashboard';

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
      setError(t('login.invalid'));
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
      setError(t('login.twoFactorInvalid'));
    } finally {
      setSubmitting(false);
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
      <Card variant="outlined" sx={{ maxWidth: 420, width: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          <Box display="flex" alignItems="center" gap={1.5} mb={1}>
            <Paper
              variant="outlined"
              sx={{ p: 1, display: 'flex', bgcolor: 'primary.main', color: 'white' }}
              aria-hidden
            >
              <MedicalServicesIcon />
            </Paper>
            <Typography variant="h5" component="h1" fontWeight={700}>
              {t('common.appName')}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" mb={3}>
            {t('login.subtitle')}
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
                {t('login.twoFactorTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>
                {t('login.twoFactorHint')}
              </Typography>
              <TextField
                label={t('login.totpCode')}
                inputMode="numeric"
                fullWidth
                margin="normal"
                autoFocus
                {...twoFactorForm.register('totpCode')}
                error={Boolean(twoFactorForm.formState.errors.totpCode)}
                helperText={twoFactorForm.formState.errors.totpCode?.message}
              />
              <TextField
                label={t('login.backupCode')}
                fullWidth
                margin="normal"
                {...twoFactorForm.register('backupCode')}
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
                  t('login.twoFactorSubmit')
                )}
              </Button>
            </Box>
          ) : (
            <Box
              component="form"
              onSubmit={loginForm.handleSubmit(handleLogin)}
              noValidate
            >
              <TextField
                label={t('login.identifier')}
                fullWidth
                margin="normal"
                autoFocus
                autoComplete="username"
                {...loginForm.register('identifier')}
                error={Boolean(loginForm.formState.errors.identifier)}
                helperText={loginForm.formState.errors.identifier?.message}
              />
              <TextField
                label={t('login.secret')}
                type="password"
                fullWidth
                margin="normal"
                autoComplete="current-password"
                {...loginForm.register('secret')}
                error={Boolean(loginForm.formState.errors.secret)}
                helperText={loginForm.formState.errors.secret?.message}
              />
              <TextField
                label={t('login.workstationId')}
                fullWidth
                margin="normal"
                {...loginForm.register('workstationId')}
                error={Boolean(loginForm.formState.errors.workstationId)}
                helperText={
                  loginForm.formState.errors.workstationId?.message ??
                  t('login.workstationHint')
                }
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
                  t('login.submit')
                )}
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}