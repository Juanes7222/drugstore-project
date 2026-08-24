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
  fetchAuditLogs,
  fetchUsers,
  type AuditLogFilters,
} from "../services/backoffice";
import type { AuditLogRow } from "../types/backoffice";
import { dateInputToIso, formatDateTime } from "../utils/format";
import { PageHeader } from "../components/common/page-header";
import { DataTable } from "../components/tables/data-table";
import { StatusChip } from "../components/common/status-chip";
import { LoadingState, ErrorState } from "../components/common/states";

const PAGE_SIZE = 20;

// Persisted audit enum values (server validates against these).
const AUDIT_ACTIONS = ["STATE_CHANGE", "SECURITY_ALERT", "LOGIN", "LOGOUT"];
const AUDIT_MODULES = [
  "SALES_POS",
  "AUTH_USERS",
  "INVENTORY_LOTS",
  "CASH_SHIFT",
  "FISCAL_DOCUMENTS",
];

export function AuditPage() {
  const { t } = useTranslation();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [action, setAction] = useState("");
  const [module, setModule] = useState("");
  const [userId, setUserId] = useState("");
  const [applied, setApplied] = useState<AuditLogFilters>({});
  const [page, setPage] = useState(1);

  // Users feed both the filter select and the row name resolution.
  const { data: usersData } = useQuery({
    queryKey: ["users", { for: "audit-filter" }],
    queryFn: () => fetchUsers({}, 1, 200),
  });

  const filters: AuditLogFilters = useMemo(
    () => ({
      from: applied.from ? dateInputToIso(applied.from) : undefined,
      to: applied.to ? dateInputToIso(applied.to) : undefined,
      action: applied.action || undefined,
      module: applied.module || undefined,
      userId: applied.userId || undefined,
    }),
    [applied],
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["audit-logs", filters, page],
    queryFn: () => fetchAuditLogs(filters, page, PAGE_SIZE),
    placeholderData: (previous) => previous,
  });

  const columns = useMemo<ColumnDef<AuditLogRow, unknown>[]>(
    () => [
      {
        id: "createdAt",
        header: t("audit.createdAt"),
        accessorKey: "createdAt",
        cell: (info) => formatDateTime(info.getValue<string>()),
      },
      {
        id: "user",
        header: t("audit.user"),
        accessorKey: "user",
        cell: (info) => {
          const user = info.getValue<AuditLogRow["user"]>();
          if (!user.fullName) return t("common.none");
          return user.displayName ?? user.fullName;
        },
      },
      {
        id: "module",
        header: t("audit.module"),
        accessorKey: "module",
        cell: (info) => (
          <Typography variant="body2" noWrap>
            {t(`audit.module_${info.getValue<string>()}`, {
              defaultValue: info.getValue<string>(),
            })}
          </Typography>
        ),
      },
      {
        id: "action",
        header: t("audit.action"),
        accessorKey: "action",
        cell: (info) => <StatusChip value={info.getValue<string>()} />,
      },
      {
        id: "entityId",
        header: t("audit.entityId"),
        accessorKey: "entityId",
        cell: (info) => (
          <Typography variant="body2" sx={{ fontFamily: "monospace" }} noWrap>
            {info.getValue<string>()}
          </Typography>
        ),
      },
      {
        id: "ipAddress",
        header: t("audit.ip"),
        accessorKey: "ipAddress",
        cell: (info) => info.getValue<string | null>() ?? "—",
      },
    ],
    [t],
  );

  return (
    <Box>
      <PageHeader title={t("audit.title")} subtitle={t("audit.subtitle")} />

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
          <Grid item xs={12} sm={4} md={2}>
            <TextField
              select
              label={t("audit.action")}
              size="small"
              fullWidth
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              <MenuItem value="">{t("common.all")}</MenuItem>
              {AUDIT_ACTIONS.map((value) => (
                <MenuItem key={value} value={value}>
                  {t(`status.${value}`, { defaultValue: value })}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={4} md={2}>
            <TextField
              select
              label={t("audit.module")}
              size="small"
              fullWidth
              value={module}
              onChange={(e) => setModule(e.target.value)}
            >
              <MenuItem value="">{t("common.all")}</MenuItem>
              {AUDIT_MODULES.map((value) => (
                <MenuItem key={value} value={value}>
                  {t(`audit.module_${value}`, { defaultValue: value })}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={4} md={2}>
            <TextField
              select
              label={t("audit.user")}
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
          <Grid item xs={12} display="flex" gap={1} justifyContent="flex-end">
            <Button
              variant="outlined"
              onClick={() => {
                setFrom("");
                setTo("");
                setAction("");
                setModule("");
                setUserId("");
                setApplied({});
                setPage(1);
              }}
            >
              {t("common.clearFilters")}
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                setApplied({ from, to, action, module, userId });
                setPage(1);
              }}
            >
              {t("common.applyFilters")}
            </Button>
          </Grid>
        </Grid>
      </Paper>

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
          getRowId={(row) => row.id}
          isLoading={isLoading}
          ariaLabel={t("audit.title")}
        />
      ) : null}
    </Box>
  );
}
