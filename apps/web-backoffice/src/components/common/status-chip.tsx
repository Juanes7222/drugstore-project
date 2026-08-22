import Chip from '@mui/material/Chip';
import { useTranslation } from 'react-i18next';

type StatusKind =
  | 'user'
  | 'sale'
  | 'shift'
  | 'fiscal'
  | 'subscription'
  | 'session';

interface StatusChipProps {
  value: string;
  // Reserved for future per-domain status styling.
  kind?: StatusKind;
}

const ERROR_STATES = new Set([
  'REJECTED',
  'ERROR',
  'GENERATION_ERROR',
  'SIGNATURE_ERROR',
  'SUSPENDED',
  'EXPIRED',
  'LOCKED',
  'ABANDONED',
]);

const WARNING_STATES = new Set([
  'PENDING_SETUP',
  'PAST_DUE',
  'DISABLED',
  'FORCED_CLOSE',
  'CONTINGENCY',
  'IN_PROGRESS',
  'PENDING_GENERATION',
  'PENDING_SIGNATURE',
  'PENDING_TRANSMISSION',
  'IN_TRANSMISSION',
  'PENDING_RESPONSE',
]);

const SUCCESS_STATES = new Set([
  'ACTIVE',
  'CONFIRMED',
  'CLOSED',
  'VALIDATED',
  'TRIAL',
  'OPEN',
]);

function chipColor(value: string): 'error' | 'warning' | 'success' | 'info' {
  if (ERROR_STATES.has(value)) return 'error';
  if (WARNING_STATES.has(value)) return 'warning';
  if (SUCCESS_STATES.has(value)) return 'success';
  return 'info';
}

/** Renders a state enum as a colored chip with a translated label. */
export function StatusChip({ value }: StatusChipProps) {
  const { t } = useTranslation();
  const label = t(`status.${value}`, { defaultValue: value });
  const color = chipColor(value);

  return <Chip size="small" color={color} variant="outlined" label={label} />;
}