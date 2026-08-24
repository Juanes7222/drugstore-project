import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { fetchFiscalStatus } from "../services/backoffice";
import { dateInputToIso, formatCop, formatDateTime } from "../utils/format";
import type { RecentRejectedDocument } from "../types/backoffice";
import { PageHeader } from "../components/common/page-header";
import { StatusChip } from "../components/common/status-chip";
import { FiscalStateBar } from "../components/charts/fiscal-state-bar";
import { WarningAmberIcon } from "../components/icons/app-icons";
import { LoadingState, ErrorState } from "../components/common/states";

export function FiscalPage() {
  const { t } = useTranslation();
  const [from, setFrom] = useState("");
  const [appliedFrom, setAppliedFrom] = useState<string | undefined>(undefined);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["fiscal-status", appliedFrom],
    queryFn: () =>
      fetchFiscalStatus(appliedFrom ? dateInputToIso(appliedFrom) : undefined),
  });

  const applyFrom = () => {
    setAppliedFrom(from || undefined);
  };

  const rejectedColumns = useMemo<ColumnDef<RecentRejectedDocument, unknown>[]>(
    () => [
      {
        id: "documentType",
        header: t("fiscal.documentType"),
        accessorKey: "documentType",
        cell: (info) =>
          t(`fiscal.type${info.getValue<string>()}`, {
            defaultValue: info.getValue<string>(),
          }),
      },
      {
        id: "fullNumber",
        header: t("fiscal.fullNumber"),
        accessorKey: "fullNumber",
        cell: (info) => info.getValue<string>(),
      },
      {
        id: "issueDate",
        header: t("fiscal.issueDate"),
        accessorKey: "issueDate",
        cell: (info) => formatDateTime(info.getValue<string>()),
      },
      {
        id: "fiscalState",
        header: t("fiscal.fiscalState"),
        accessorKey: "fiscalState",
        cell: (info) => (
          <StatusChip value={info.getValue<string>()} kind="fiscal" />
        ),
      },
      {
        id: "ptResponseCode",
        header: t("fiscal.responseCode"),
        accessorKey: "ptResponseCode",
        cell: (info) => info.getValue<string | null>() ?? "—",
      },
      {
        id: "ptResponseMessage",
        header: t("fiscal.responseMessage"),
        accessorKey: "ptResponseMessage",
        cell: (info) => (
          <Typography variant="body2" sx={{ maxWidth: 320 }} noWrap>
            {info.getValue<string | null>() ?? "—"}
          </Typography>
        ),
      },
      {
        id: "retryCount",
        header: t("fiscal.retryCount"),
        accessorKey: "retryCount",
        meta: { align: "right" },
        cell: (info) => info.getValue<number>(),
      },
      {
        id: "totalAmount",
        header: t("fiscal.totalAmount"),
        accessorKey: "totalAmount",
        meta: { align: "right" },
        cell: (info) => formatCop(info.getValue<string>()),
      },
    ],
    [t],
  );

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  const hasRejections = data.recentRejected.length > 0;

  return (
    <Box>
      <PageHeader title={t("fiscal.title")} subtitle={t("fiscal.subtitle")} />

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={4} md={3}>
            <TextField
              label={t("fiscal.from")}
              type="date"
              size="small"
              fullWidth
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm="auto">
            <Button variant="contained" onClick={applyFrom}>
              {t("common.applyFilters")}
            </Button>
          </Grid>
        </Grid>
      </Paper>

      <FiscalStateBar counts={data.countsByState} />

      <Paper
        variant="outlined"
        sx={{
          p: 2,
          mb: 3,
          ...(hasRejections
            ? { borderColor: "error.main", borderWidth: 1 }
            : {}),
        }}
      >
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          {hasRejections ? (
            <Box component="span" sx={{ color: "error.main", display: "flex" }} aria-hidden>
              <WarningAmberIcon size={20} />
            </Box>
          ) : null}
          <Typography variant="subtitle1" fontWeight={700}>
            {t("fiscal.recentRejected")}
          </Typography>
        </Box>
        {hasRejections ? (
          <RejectedTable columns={rejectedColumns} data={data.recentRejected} />
        ) : (
          <Typography
            variant="body2"
            color="text.secondary"
            py={3}
            textAlign="center"
          >
            {t("common.empty")}
          </Typography>
        )}
      </Paper>
    </Box>
  );
}

function RejectedTable({
  columns,
  data,
}: {
  columns: ColumnDef<RecentRejectedDocument, unknown>[];
  data: RecentRejectedDocument[];
}) {
  const { t } = useTranslation();
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <TableContainer>
      <Table size="small" aria-label={t("fiscal.recentRejected")}>
        <TableHead>
          <TableRow>
            {table.getHeaderGroups()[0]?.headers.map((header) => (
              <TableCell
                key={header.id}
                sx={{ fontWeight: 700 }}
                align={header.column.columnDef.meta?.align}
              >
                {flexRender(
                  header.column.columnDef.header,
                  header.getContext(),
                )}
              </TableCell>
            ))}
          </TableRow>
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
        </TableBody>
      </Table>
    </TableContainer>
  );
}
