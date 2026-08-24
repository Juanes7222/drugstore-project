import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";

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
      gap={1}
      py={8}
    >
      <Typography variant="body1" color="error">
        {t("common.error")}
      </Typography>
      {onRetry ? (
        <Button variant="outlined" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      ) : null}
    </Box>
  );
}
