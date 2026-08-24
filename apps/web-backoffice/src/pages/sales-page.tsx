import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  fetchSales,
  fetchUsers,
  fetchWorkstations,
  type SalesFilters,
} from "../services/backoffice";
import { dateInputToIso, formatCop, formatDateTime } from "../utils/format";
import type { SaleRow } from "../types/backoffice";
import { PageHeader } from "../components/common/page-header";
import { DataTable } from "../components/tables/data-table";
import { StatusChip } from "../components/common/status-chip";
import { LoadingState, ErrorState } from "../components/common/states";

const PAGE_SIZE = 20;
const SALE_STATES = ["CONFIRMED", "ANNULLED", "IN_PROGRESS", "ABANDONED"];

export function SalesPage() {
  const { t } = useTranslation();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [state, setState] = useState("");
  const [userId, setUserId] = useState("");
  const [workstationId, setWorkstationId] = useState("");
  const [applied, setApplied] = useState<SalesFilters>({});
  const [page, setPage] = useState(1);

  const filters: SalesFilters = useMemo(
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
    queryKey: ["sales", filters, page],
    queryFn: () => fetchSales(filters, page, PAGE_SIZE),
    placeholderData: (previous) => previous,
  });

  const { data: usersData } = useQuery({
    queryKey: ["users", { for: "sales-filter" }],
    queryFn: () => fetchUsers({}, 1, 200),
  });

  const { data: workstationsData } = useQuery({
    queryKey: ["workstations", { for: "sales-filter" }],
    queryFn: fetchWorkstations,
  });

  const applyFilters = () => {
    setApplied({ from, to, state, userId, workstationId });
    setPage(1);
  };

  const clearFilters = () => {
    setFrom("");
    setTo("");
    setState("");
    setUserId("");
    setWorkstationId("");
    setApplied({});
    setPage(1);
  };

  const columns = useMemo<ColumnDef<SaleRow, unknown>[]>(
    () => [
      {
        id: "localNumber",
        header: t("sales.localNumber"),
        accessorKey: "localNumber",
        cell: (info) => info.getValue<number>(),
      },
      {
        id: "internalNumber",
        header: t("sales.internalNumber"),
        accessorKey: "internalNumber",
        cell: (info) => info.getValue<string | null>() ?? "—",
      },
      {
        id: "state",
        header: t("sales.state"),
        accessorKey: "operationalState",
        cell: (info) => (
          <StatusChip value={info.getValue<string>()} kind="sale" />
        ),
      },
      {
        id: "confirmedAt",
        header: t("sales.confirmedAt"),
        accessorKey: "confirmedAt",
        cell: (info) => formatDateTime(info.getValue<string | null>()),
      },
      {
        id: "client",
        header: t("sales.client"),
        accessorKey: "clientNameSnapshot",
        cell: (info) => info.getValue<string | null>() ?? "—",
      },
      {
        id: "user",
        header: t("sales.user"),
        accessorKey: "user",
        cell: (info) =>
          info.getValue<SaleRow["user"]>().displayName ??
          info.getValue<SaleRow["user"]>().fullName,
      },
      {
        id: "workstation",
        header: t("sales.workstation"),
        accessorKey: "workstation",
        cell: (info) => {
          const ws = info.getValue<SaleRow["workstation"]>();
          return `${ws.name} (${ws.code})`;
        },
      },
      {
        id: "subtotal",
        header: t("sales.subtotal"),
        accessorKey: "subtotal",
        align: "right",
        cell: (info) => formatCop(info.getValue<string>()),
      },
      {
        id: "totalDiscount",
        header: t("sales.discount"),
        accessorKey: "totalDiscount",
        align: "right",
        cell: (info) => formatCop(info.getValue<string>()),
      },
      {
        id: "totalTax",
        header: t("sales.tax"),
        accessorKey: "totalTax",
        align: "right",
        cell: (info) => formatCop(info.getValue<string>()),
      },
      {
        id: "totalAmount",
        header: t("sales.total"),
        accessorKey: "totalAmount",
        align: "right",
        cell: (info) => (
          <Typography variant="body2" fontWeight={700}>
            {formatCop(info.getValue<string>())}
          </Typography>
        ),
      },
    ],
    [t],
  );

  return (
    <Box>
      <PageHeader title={t("sales.title")} subtitle={t("sales.subtitle")} />

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              label={t("common.from")}
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
              label={t("common.to")}
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
              label={t("sales.state")}
              size="small"
              fullWidth
              value={state}
              onChange={(e) => setState(e.target.value)}
            >
              <MenuItem value="">{t("common.all")}</MenuItem>
              {SALE_STATES.map((s) => (
                <MenuItem key={s} value={s}>
                  {t(`status.${s}`, { defaultValue: s })}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              select
              label={t("sales.user")}
              size="small"
              fullWidth
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <MenuItem value="">{t("common.all")}</MenuItem>
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
              label={t("sales.workstation")}
              size="small"
              fullWidth
              value={workstationId}
              onChange={(e) => setWorkstationId(e.target.value)}
            >
              <MenuItem value="">{t("common.all")}</MenuItem>
              {workstationsData?.workstations.map((ws) => (
                <MenuItem key={ws.id} value={ws.id}>
                  {ws.name} ({ws.code})
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} display="flex" gap={1} justifyContent="flex-end">
            <Button variant="outlined" onClick={clearFilters}>
              {t("common.clearFilters")}
            </Button>
            <Button variant="contained" onClick={applyFilters}>
              {t("common.applyFilters")}
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {data ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle2" fontWeight={700} mb={1}>
            {t("sales.summary")}
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
              >
                {t("sales.summaryCount")}
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {data.summary.count}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
              >
                {t("sales.summaryTotal")}
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {formatCop(data.summary.totalAmount)}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
              >
                {t("sales.summaryTax")}
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {formatCop(data.summary.totalTax)}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
              >
                {t("sales.summaryDiscount")}
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {formatCop(data.summary.totalDiscount)}
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
