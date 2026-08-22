import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { fetchCashShifts, fetchUsers, fetchWorkstations, type CashShiftFilters } from '../services/backoffice';
import { dateInputToIso, formatCop, formatDateTime } from '../utils/format';
import type { CashShiftRow } from '../types/backoffice';
import { PageHeader } from '../components/common/page-header';
import { DataTable } from '../components/tables/data-table';
import { StatusChip } from '../components/common/status-chip';
import { LoadingState, ErrorState } from '../components/common/states';

const PAGE_SIZE = 20;
const SHIFT_STATES = ['OPEN', 'CLOSED', 'FORCED_CLOSE'];

export function CashShiftsPage() {
  const { t } = useTranslation();

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [state, setState] = useState('');
  const [userId, setUserId] = useState('');
  const [workstationId, setWorkstationId] = useState('');
  const [applied, setApplied] = useState<CashShiftFilters>({});
  const [page, setPage] = useState(1);

  const filters: CashShiftFilters = useMemo(
    () => ({
      from: applied.from ? dateInputToIso(applied.from) : undefined,
      to: applied.to ? dateInputToIso(applied.to) : undefined,
      state: applied.state || undefined,
      userId: applied.userId || undefined,
      workstationId: applied.workstationId || undefined,
    }),
    [applied],
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['cash-shifts', filters, page],
    queryFn: () => fetchCashShifts(filters, page, PAGE_SIZE),
    placeholderData: (previous) => previous,
  });

  const { data: usersData } = useQuery({
    queryKey: ['users', { for: 'cash-shift-filter' }],
    queryFn: () => fetchUsers({}, 1, 200),
  });

  const { data: workstationsData } = useQuery({
    queryKey: ['workstations', { for: 'cash-shift-filter' }],
    queryFn: fetchWorkstations,
  });

  const applyFilters = () => {
    setApplied({ from, to, state, userId, workstationId });
    setPage(1);
  };

  const clearFilters = () => {
    setFrom('');
    setTo('');
    setState('');
    setUserId('');
    setWorkstationId('');
    setApplied({});
    setPage(1);
  };

  const columns = useMemo<ColumnDef<CashShiftRow, unknown>[]>(
    () => [
      {
        id: 'openedAt',
        header: t('cashShifts.openedAt'),
        accessorKey: 'openedAt',
        cell: (info) => formatDateTime(info.getValue<string>()),
      },
      {
        id: 'closedAt',
        header: t('cashShifts.closedAt'),
        accessorKey: 'closedAt',
        cell: (info) => formatDateTime(info.getValue<string | null>()),
      },
      {
        id: 'state',
        header: t('cashShifts.state'),
        accessorKey: 'state',
        cell: (info) => (
          <StatusChip value={info.getValue<string>()} kind="shift" />
        ),
      },
      {
        id: 'workstation',
        header: t('sales.workstation'),
        accessorKey: 'workstation',
        cell: (info) => {
          const ws = info.getValue<CashShiftRow['workstation']>();
          return `${ws.name} (${ws.code})`;
        },
      },
      {
        id: 'user',
        header: t('sales.user'),
        accessorKey: 'user',
        cell: (info) =>
          info.getValue<CashShiftRow['user']>().displayName ??
          info.getValue<CashShiftRow['user']>().fullName,
      },
      {
        id: 'openingBalance',
        header: t('cashShifts.openingBalance'),
        accessorKey: 'openingBalance',
        align: 'right',
        cell: (info) => formatCop(info.getValue<string>()),
      },
      {
        id: 'expectedClosingAmount',
        header: t('cashShifts.expected'),
        accessorKey: 'expectedClosingAmount',
        align: 'right',
        cell: (info) => formatCop(info.getValue<string | null>()),
      },
      {
        id: 'actualClosingAmount',
        header: t('cashShifts.actual'),
        accessorKey: 'actualClosingAmount',
        align: 'right',
        cell: (info) => formatCop(info.getValue<string | null>()),
      },
      {
        id: 'closingDifference',
        header: t('cashShifts.difference'),
        accessorKey: 'closingDifference',
        align: 'right',
        cell: (info) => {
          const raw = info.getValue<string | null>();
          if (raw === null) return '—';
          const numeric = Number(raw);
          const color =
            numeric === 0 ? 'text.secondary' : numeric < 0 ? 'error.main' : 'error.main';
          return (
            <Typography variant="body2" fontWeight={700} sx={{ color }}>
              {formatCop(raw)}
            </Typography>
          );
        },
      },
      {
        id: 'flags',
        header: t('common.actions'),
        enableSorting: false,
        cell: (info) => {
          const row = info.row.original;
          return (
            <Box display="flex" gap={0.5}>
              {row.forcedClose ? (
                <Chip
                  size="small"
                  color="warning"
                  variant="outlined"
                  label={t('cashShifts.forcedClose')}
                />
              ) : null}
              {row.hasExtendedAlert ? (
                <Chip
                  size="small"
                  color="info"
                  variant="outlined"
                  label={t('cashShifts.extendedAlert')}
                />
              ) : null}
              {!row.forcedClose && !row.hasExtendedAlert ? '—' : null}
            </Box>
          );
        },
      },
    ],
    [t],
  );

  return (
    <Box>
      <PageHeader title={t('cashShifts.title')} subtitle={t('cashShifts.subtitle')} />

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              label={t('common.from')}
              type="date"
              size="small"
              fullWidth
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              label={t('common.to')}
              type="date"
              size="small"
              fullWidth
              value={to}
              onChange={(e) => setTo(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              select
              label={t('cashShifts.state')}
              size="small"
              fullWidth
              value={state}
              onChange={(e) => setState(e.target.value)}
            >
              <MenuItem value="">{t('common.all')}</MenuItem>
              {SHIFT_STATES.map((s) => (
                <MenuItem key={s} value={s}>
                  {t(`status.${s}`, { defaultValue: s })}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              select
              label={t('sales.user')}
              size="small"
              fullWidth
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <MenuItem value="">{t('common.all')}</MenuItem>
              {usersData?.users.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {u.displayName ?? u.fullName}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              select
              label={t('sales.workstation')}
              size="small"
              fullWidth
              value={workstationId}
              onChange={(e) => setWorkstationId(e.target.value)}
            >
              <MenuItem value="">{t('common.all')}</MenuItem>
              {workstationsData?.workstations.map((ws) => (
                <MenuItem key={ws.id} value={ws.id}>
                  {ws.name} ({ws.code})
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} display="flex" gap={1} justifyContent="flex-end">
            <Button variant="outlined" onClick={clearFilters}>
              {t('common.clearFilters')}
            </Button>
            <Button variant="contained" onClick={applyFilters}>
              {t('common.applyFilters')}
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {data ? (
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            mb: 3,
            borderLeft: `4px solid`,
            borderLeftColor:
              data.summary.differenceCount > 0 ? 'warning.main' : 'success.main',
          }}
        >
          <Typography variant="subtitle2" fontWeight={700} mb={1}>
            {t('cashShifts.summary')}
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary" display="block">
                {t('cashShifts.differenceCount')}
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {data.summary.differenceCount}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary" display="block">
                {t('cashShifts.differenceAmount')}
              </Typography>
              <Typography
                variant="body1"
                fontWeight={600}
                sx={{
                  color:
                    Number(data.summary.differenceAmount) === 0
                      ? 'text.primary'
                      : 'error.main',
                }}
              >
                {formatCop(data.summary.differenceAmount)}
              </Typography>
            </Grid>
          </Grid>
        </Paper>
      ) : null}

      {isLoading && !data ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : data ? (
        <DataTable
          columns={columns}
          data={data.data}
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          totalPages={data.totalPages}
          onPageChange={setPage}
          onPageSizeChange={() => undefined}
          getRowId={(row) => row.id}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
        />
      ) : null}
    </Box>
  );
}