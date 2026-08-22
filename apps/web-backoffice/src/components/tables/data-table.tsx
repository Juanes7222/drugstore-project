import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  isLoading?: boolean;
  isError?: boolean;
  errorHint?: string;
  onRetry?: () => void;
  emptyMessage?: string;
  getRowId?: (row: T) => string;
}

/**
 * Server-paginated table built on TanStack Table.
 * Sorting is client-side and only applies to the current page; the backend
 * contract does not expose sort parameters.
 */
export function DataTable<T>({
  columns,
  data,
  total,
  page,
  pageSize,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
  isLoading = false,
  isError = false,
  errorHint,
  onRetry,
  emptyMessage,
  getRowId,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: totalPages,
    getRowId,
  });

  const emptyRowCount = useMemo(
    () => Math.max(0, pageSize - table.getRowModel().rows.length),
    [pageSize, table],
  );

  const handlePageChange = (_: unknown, nextPage: number) => {
    onPageChange(nextPage + 1);
  };

  const handlePageSizeChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    onPageSizeChange?.(Number(event.target.value));
  };

  return (
    <Paper variant="outlined" sx={{ width: '100%', overflow: 'hidden' }}>
      <TableContainer>
        <Table aria-label="data-table" size="small">
          <TableHead>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  return (
                    <TableCell
                      key={header.id}
                      sortDirection={sortDir}
                      sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}
                    >
                      {canSort ? (
                        <TableSortLabel
                          active={sortDir !== false}
                          direction={sortDir === 'asc' ? 'asc' : 'desc'}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                        </TableSortLabel>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableHead>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} hover>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {!isLoading && table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  align="center"
                  sx={{ py: 6 }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {isError ? errorHint ?? t('common.error') : emptyMessage ?? t('common.empty')}
                  </Typography>
                  {isError && onRetry ? (
                    <Box mt={1}>
                      <Typography
                        component="button"
                        onClick={onRetry}
                        color="primary"
                        sx={{ cursor: 'pointer', border: 'none', bgcolor: 'transparent', textDecoration: 'underline' }}
                      >
                        {t('common.retry')}
                      </Typography>
                    </Box>
                  ) : null}
                </TableCell>
              </TableRow>
            ) : null}
            {/* Keep rows at a stable height while loading to avoid layout jumps. */}
            {isLoading
              ? Array.from({ length: Math.min(emptyRowCount, 5) }).map(
                  (_, i) => (
                    <TableRow key={`skeleton-${i}`}>
                      <TableCell colSpan={columns.length} />
                    </TableRow>
                  ),
                )
              : null}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={total}
        page={page - 1}
        rowsPerPage={pageSize}
        onPageChange={handlePageChange}
        onRowsPerPageChange={handlePageSizeChange}
        rowsPerPageOptions={pageSizeOptions}
        labelRowsPerPage={t('common.rowsPerPage')}
        labelDisplayedRows={({ from, to, count }) =>
          `${from}–${to} ${t('common.of')} ${count}`
        }
        disabled={isLoading}
      />
    </Paper>
  );
}