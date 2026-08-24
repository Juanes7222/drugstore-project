import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { SyncProblemIcon, RefreshIcon } from "../icons/app-icons";

export function LoadingState() {
  const { t } = useTranslation();
  return (
    <Box
      role="status"
      aria-live="polite"
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      gap={2}
      py={8}
    >
      <CircularProgress size={36} />
      <Typography variant="body2" color="text.secondary">
        {t("common.loading")}
      </Typography>
    </Box>
  );
}

interface ErrorStateProps {
  onRetry?: () => void;
}

export function ErrorState({ onRetry }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <Box
      role="alert"
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      gap={1.5}
      py={8}
    >
      <Box component="span" sx={{ color: "text.disabled", display: "flex" }}>
        <SyncProblemIcon size={40} aria-hidden />
      </Box>
      <Typography variant="body1" color="error" align="center">
        {t("common.error")}
      </Typography>
      {onRetry ? (
        <Button
          variant="outlined"
          size="small"
          startIcon={<RefreshIcon fontSize="small" />}
          onClick={onRetry}
        >
          {t("common.retry")}
        </Button>
      ) : null}
    </Box>
  );
}
