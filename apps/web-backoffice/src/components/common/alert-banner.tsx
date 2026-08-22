import Alert, { type AlertColor } from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Link from '@mui/material/Link';
import { Link as RouterLink } from 'react-router-dom';

interface AlertBannerProps {
  severity: AlertColor;
  title: string;
  message: string;
  to?: string;
  actionLabel?: string;
}

/** Alert banner for dashboard problem states; optional deep link to the page. */
export function AlertBanner({
  severity,
  title,
  message,
  to,
  actionLabel,
}: AlertBannerProps) {
  return (
    <Alert
      severity={severity}
      action={
        to ? (
          <Link
            component={RouterLink}
            to={to}
            color="inherit"
            underline="always"
          >
            {actionLabel}
          </Link>
        ) : null
      }
    >
      <AlertTitle>{title}</AlertTitle>
      {message}
    </Alert>
  );
}