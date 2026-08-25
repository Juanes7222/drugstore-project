import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { alpha, useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import {
  CancelIcon,
  InfoIcon,
  WarningAmberIcon,
} from "../icons/app-icons";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  severity?: "error" | "warning" | "info";
  onConfirm: () => void;
  onClose: () => void;
}

const SEVERITY_ICON = {
  error: CancelIcon,
  warning: WarningAmberIcon,
  info: InfoIcon,
} as const;

/**
 * Accessible confirmation dialog. Focus lands on the safe action (cancel)
 * so an accidental Enter never confirms a destructive operation; the
 * confirm button shows a spinner while the mutation resolves.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  severity = "warning",
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [busy, setBusy] = useState(false);

  const Icon = SEVERITY_ICON[severity];
  const toneColor =
    severity === "error"
      ? theme.palette.error.main
      : severity === "info"
        ? theme.palette.info.main
        : theme.palette.warning.main;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
      maxWidth="xs"
      fullWidth
      TransitionProps={{ timeout: 200 }}
    >
      <DialogTitle id="confirm-dialog-title" component="div">
        <Box display="flex" alignItems="center" gap={1.5}>
          <Box
            aria-hidden
            display="flex"
            alignItems="center"
            justifyContent="center"
            sx={{
              width: 38,
              height: 38,
              borderRadius: 999,
              flexShrink: 0,
              color: toneColor,
              bgcolor: alpha(toneColor, theme.palette.mode === "dark" ? 0.18 : 0.11),
            }}
          >
            <Icon size={19} />
          </Box>
          <Box component="span">{title}</Box>
        </Box>
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="confirm-dialog-description">
          {message}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        {/* Safe action takes initial focus; busy state also closes the
            escape hatch so a pending mutation can't be double-fired. */}
        <Button onClick={onClose} disabled={busy} autoFocus>
          {cancelLabel ?? t("common.cancel")}
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={busy}
          color={severity === "error" ? "error" : "primary"}
          variant="contained"
          startIcon={
            busy ? <CircularProgress size={14} color="inherit" /> : undefined
          }
        >
          {confirmLabel ?? t("common.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
