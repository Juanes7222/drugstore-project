import { useMemo } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { fetchInventoryAlerts } from '../services/backoffice';
import { formatDate, formatDateTime, formatNumber } from '../utils/format';
import type { LotAlert, PendingAdjustment } from '../types/backoffice';
import { PageHeader } from '../components/common/page-header';
import { LoadingState, ErrorState } from '../components/common/states';

function SectionCard({
  title,
  tone,
  children,
}: {
  title: string;
  tone: 'default' | 'warning' | 'error';
  children: React.ReactNode;
}) {
  const borderColor =
    tone === 'error' ? 'error.main' : tone === 'warning' ? 'warning.main' : 'divider';
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 3, borderTop: `4px solid ${borderColor}` }}>
      <Typography variant="subtitle1" fontWeight={700} mb={2}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

/** Non-paginated table for sections without a backend pagination contract. */
function SimpleTable<T>({
  columns,
  data,
  emptyMessage,
  getRowId,
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  emptyMessage: string;
  getRowId: (row: T) => string;
}) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
  });

  return (
    <TableContainer>
      <Table size="small" aria-label="simple-table">
        <TableHead>
          <TableRow>
            {table.getHeaderGroups()[0]?.headers.map((header) => (
              <TableCell
                key={header.id}
                sx={{ fontWeight: 700 }}
                align={header.column.columnDef.meta?.align}
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} align="center" sx={{ py: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  {emptyMessage}
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} hover>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} align={cell.column.columnDef.meta?.align}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export function InventoryAlertsPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['inventory-alerts'],
    queryFn: fetchInventoryAlerts,
  });

  const pendingColumns = useMemo<ColumnDef<PendingAdjustment, unknown>[]>(
    () => [
      {
        id: 'sequentialNumber',
        header: t('inventory.sequentialNumber'),
        accessorKey: 'sequentialNumber',
        cell: (info) => info.getValue<number>(),
      },
      {
        id: 'reason',
        header: t('inventory.reason'),
        accessorKey: 'reason',
        cell: (info) => info.getValue<string>(),
      },
      {
        id: 'notes',
        header: t('inventory.notes'),
        accessorKey: 'notes',
        cell: (info) => info.getValue<string | null>() ?? '—',
      },
      {
        id: 'createdBy',
        header: t('inventory.createdBy'),
        accessorKey: 'createdByUser',
        cell: (info) =>
          info.getValue<PendingAdjustment['createdByUser']>().displayName ??
          info.getValue<PendingAdjustment['createdByUser']>().fullName,
      },
      {
        id: 'createdAt',
        header: t('inventory.createdAt'),
        accessorKey: 'createdAt',
        cell: (info) => formatDateTime(info.getValue<string>()),
      },
      {
        id: 'submittedAt',
        header: t('inventory.submittedAt'),
        accessorKey: 'submittedForApprovalAt',
        cell: (info) => formatDateTime(info.getValue<string>()),
      },
    ],
    [t],
  );

  const lotColumns = useMemo<ColumnDef<LotAlert, unknown>[]>(
    () => [
      {
        id: 'product',
        header: t('inventory.product'),
        accessorKey: 'product',
        cell: (info) => info.getValue<LotAlert['product']>().commercialName,
      },
      {
        id: 'batchNumber',
        header: t('inventory.batchNumber'),
        accessorKey: 'batchNumber',
        cell: (info) => info.getValue<string>(),
      },
      {
        id: 'expirationDate',
        header: t('inventory.expirationDate'),
        accessorKey: 'expirationDate',
        cell: (info) => formatDate(info.getValue<string>()),
      },
      {
        id: 'currentStock',
        header: t('inventory.currentStock'),
        accessorKey: 'currentStock',
        meta: { align: 'right' },
        cell: (info) => formatNumber(info.getValue<number>()),
      },
    ],
    [t],
  );

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <Box>
      <PageHeader title={t('inventory.title')} subtitle={t('inventory.subtitle')} />

      <SectionCard
        title={t('inventory.pendingAdjustments')}
        tone={data.pendingAdjustments.length > 0 ? 'warning' : 'default'}
      >
        <SimpleTable
          columns={pendingColumns}
          data={data.pendingAdjustments}
          emptyMessage={t('inventory.none')}
          getRowId={(row) => row.id}
        />
      </SectionCard>

      <SectionCard
        title={t('inventory.lowStock')}
        tone={data.lowStock.length > 0 ? 'warning' : 'default'}
      >
        <TableContainer>
          <Table size="small" aria-label={t('inventory.lowStock')}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>{t('inventory.product')}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>
                  {t('inventory.currentStock')}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>
                  {t('inventory.minimumStock')}
                </TableCell>
                <TableCell sx={{ width: '30%', fontWeight: 700 }}>
                  {t('inventory.ratio')}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.lowStock.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                    <Typography variant="body2" color="text.secondary">
                      {t('inventory.none')}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                data.lowStock.map((item) => {
                  const ratio =
                    item.minimumStock > 0
                      ? Math.min(1, item.currentStock / item.minimumStock)
                      : 0;
                  return (
                    <TableRow key={item.productId} hover>
                      <TableCell>{item.commercialName}</TableCell>
                      <TableCell align="right">{formatNumber(item.currentStock)}</TableCell>
                      <TableCell align="right">{formatNumber(item.minimumStock)}</TableCell>
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={1}>
                          <LinearProgress
                            variant="determinate"
                            value={ratio * 100}
                            color={ratio < 0.5 ? 'error' : 'warning'}
                            sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {Math.round(ratio * 100)}%
                          </Typography>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <SectionCard
        title={t('inventory.expiringLots')}
        tone={data.expiringLots.length > 0 ? 'warning' : 'default'}
      >
        <SimpleTable
          columns={lotColumns}
          data={data.expiringLots}
          emptyMessage={t('inventory.none')}
          getRowId={(row) => row.id}
        />
      </SectionCard>

      <SectionCard
        title={t('inventory.expiredLots')}
        tone={data.expiredLots.length > 0 ? 'error' : 'default'}
      >
        <SimpleTable
          columns={lotColumns}
          data={data.expiredLots}
          emptyMessage={t('inventory.none')}
          getRowId={(row) => row.id}
        />
      </SectionCard>
    </Box>
  );
}