import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { BrandMark } from "../common/brand-mark";
import { LockIcon } from "../icons/app-icons";

interface AuthActionShellProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
}

/**
 * Centered single-column layout for the standalone emailed-link pages
 * (/verify-email, /reset-password).
 *
 * These routes are opened from a mail client, signed out and outside the
 * backoffice chrome, so they get their own minimal shell rather than
 * BackofficeLayout.
 */
export function AuthActionShell({
  title,
  subtitle,
  icon,
  children,
}: AuthActionShellProps) {
  const { t } = useTranslation();

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        px: 2,
        py: { xs: 4, md: 6 },
        bgcolor: "background.default",
      }}
    >
      <Card variant="outlined" className="animate-fade-up" sx={{ width: "100%", maxWidth: 448 }}>
        <Box px={{ xs: 3, sm: 4 }} py={{ xs: 3.5, sm: 4 }}>
          <Box display="flex" alignItems="center" gap={1.25} mb={2.5}>
            <BrandMark size={34} />
            {icon ? (
              <Box sx={{ color: "text.secondary", display: "flex" }}>{icon}</Box>
            ) : null}
          </Box>

          <Typography
            variant="h5"
            component="h1"
            fontWeight={700}
            sx={{ letterSpacing: "-0.02em" }}
          >
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="body2" color="text.secondary" mt={0.5}>
              {subtitle}
            </Typography>
          ) : null}

          <Box mt={3}>{children}</Box>

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
  );
}