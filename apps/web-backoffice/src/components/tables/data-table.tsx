import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TablePagination from "@mui/material/TablePagination";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Typography from "@mui/material/Typography";
import Skeleton from "@mui/material/Skeleton";
import Button from "@mui/material/Button";
import { alpha, useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { InboxIcon, RefreshIcon } from "../icons/app-icons";

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
  /** Accessible name; should describe what the table lists. */
  ariaLabel?: string;
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
  ariaLabel,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const theme = useTheme();
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

  // Callers sometimes pass a page size that mirrors the server payload
  // (e.g. "all rows on one page"); the select must never receive a value
  // outside its option list.
  const paginationOptions = useMemo(
    () =>
      pageSizeOptions.includes(pageSize)
        ? pageSizeOptions
        : [...pageSizeOptions, pageSize].sort((a, b) => a - b),
    [pageSizeOptions, pageSize],
  );

  // Single-page tables render without pagination controls: they carry no
  // information there and only invite dead interactions.
  const showPagination = totalPages > 1;

  const handlePageChange = (_: unknown, nextPage: number) => {
    onPageChange(nextPage + 1);
  };

  const handlePageSizeChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    onPageSizeChange?.(Number(event.target.value));
  };

  return (
    <Paper variant="outlined" sx={{ width: "100%", overflow: "hidden" }}>
      <TableContainer>
        <Table aria-label={ariaLabel ?? t("common.dataTable")} size="small">
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
                      align={header.column.columnDef.meta?.align}
                      sx={{ fontWeight: 700, whiteSpace: "nowrap" }}
                    >
                      {canSort ? (
                        <TableSortLabel
                          active={sortDir !== false}
                          direction={sortDir === "asc" ? "asc" : "desc"}
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
                  <TableCell
                    key={cell.id}
                    align={cell.column.columnDef.meta?.align}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {!isLoading && table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  <Box
                    display="flex"
                    flexDirection="column"
                    alignItems="center"
                    gap={1.5}
                    py={6}
                    color={isError ? "error.main" : "text.secondary"}
                  >
                    {/* Soft tinted disc: the empty state reads as an
                        invitation, not a broken cell. */}
                    <Box
                      aria-hidden
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      sx={{
                        width: 52,
                        height: 52,
                        borderRadius: "50%",
                        bgcolor: isError
                          ? alpha(theme.palette.error.main, 0.1)
                          : alpha(theme.palette.text.primary, 0.05),
                      }}
                    >
                      <InboxIcon size={24} />
                    </Box>
                    <Typography variant="body2" align="center">
                      {isError
                        ? (errorHint ?? t("common.error"))
                        : (emptyMessage ?? t("common.empty"))}
                    </Typography>
                    {isError && onRetry ? (
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
                </TableCell>
              </TableRow>
            ) : null}
            {/* Keep rows at a stable height while loading to avoid layout jumps. */}
            {isLoading
              ? Array.from({ length: Math.min(emptyRowCount, 5) }).map(
                  (_, i) => (
                    <TableRow key={`skeleton-${i}`}>
                      <TableCell colSpan={columns.length}>
                        {/* Deterministic widths read as content, not a flat bar. */}
                        <Skeleton
                          variant="text"
                          sx={{ fontSize: "0.875rem" }}
                          width={`${55 + ((i * 17) % 35)}%`}
                        />
                      </TableCell>
                    </TableRow>
                  ),
                )
              : null}
          </TableBody>
        </Table>
      </TableContainer>
      {showPagination ? (
        <TablePagination
          component="div"
          count={total}
          page={page - 1}
          rowsPerPage={pageSize}
          onPageChange={handlePageChange}
          onRowsPerPageChange={handlePageSizeChange}
          rowsPerPageOptions={paginationOptions}
          labelRowsPerPage={t("common.rowsPerPage")}
          labelDisplayedRows={({ from, to, count }) =>
            `${from}–${to} ${t("common.of")} ${count}`
          }
          disabled={isLoading}
        />
      ) : null}
    </Paper>
  );
}
