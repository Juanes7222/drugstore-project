import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { fetchSaasCustomer } from "../../services/saas-admin";
import {
  fetchSaasCustomerDashboard,
  fetchSaasCustomerFiscalStatus,
  fetchSaasCustomerSales,
  fetchSaasCustomerSessions,
  fetchSaasCustomerUsers,
  fetchSaasCustomerWorkstations,
} from "../../services/saas-admin";
import type { SaasAdminTabKey } from "../../types/saas-admin";
import type {
  RecentRejectedDocument,
  SaleRow,
  SessionRow,
  UserListItem,
  WorkstationRow,
} from "../../types/backoffice";
import {
  dateInputToIso,
  formatCop,
  formatDate,
  formatDateTime,
  formatNumber,
} from "../../utils/format";
import { KpiCard } from "../../components/common/kpi-card";
import { PageHeader } from "../../components/common/page-header";
import { DataTable } from "../../components/tables/data-table";
import { StatusChip } from "../../components/common/status-chip";
import { FiscalStateBar } from "../../components/charts/fiscal-state-bar";
import { LoadingState, ErrorState } from "../../components/common/states";

const PAGE_SIZE = 20;

const SALE_STATES = ["IN_PROGRESS", "CONFIRMED", "ANNULLED", "ABANDONED"] as const;

/** Detail view for one subscribed customer, tabbed per data domain. */
export function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  // Route param guard keeps every child hook free of undefined-id branches.
  if (!customerId) {
    return <Navigate to="/admin/customers" replace />;
  }
  return <CustomerDetailContent id={customerId} />;
}

function CustomerDetailContent({ id }: { id: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<SaasAdminTabKey>("overview");

  const { data: customer, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-customer", id],
    queryFn: () => fetchSaasCustomer(id),
  });

  const tabs: { key: SaasAdminTabKey; label: string }[] = [
    { key: "overview", label: t("saas.customer.tabsOverview") },
    { key: "sales", label: t("saas.customer.tabsSales") },
    { key: "users", label: t("saas.customer.tabsUsers") },
    { key: "sessions", label: t("saas.customer.tabsSessions") },
    { key: "workstations", label: t("saas.customer.tabsWorkstations") },
    { key: "fiscal", label: t("saas.customer.tabsFiscal") },
  ];

  return (
    <Box>
      <Button
        variant="text"
        size="small"
        onClick={() => navigate("/admin/customers")}
        sx={{ mb: 1 }}
      >
        ← {t("saas.customer.backToList")}
      </Button>

      {isLoading && !customer ? (
        <LoadingState />
      ) : isError || !customer ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
        <>
          <PageHeader
            title={customer.customerName}
            subtitle={t("saas.customer.planLabel", {
              name: customer.plan.name,
              taxId: customer.customerTaxId,
            })}
            actions={<StatusChip value={customer.status} kind="subscription" />}
          />

          <Tabs
            value={tab}
            onChange={(_, value: SaasAdminTabKey) => setTab(value)}
            aria-label={t("common.mainNav")}
            sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
          >
            {tabs.map((item) => (
              <Tab key={item.key} value={item.key} label={item.label} />
            ))}
          </Tabs>

          {/* Only the active panel mounts, so each tab loads its own data. */}
          {tab === "overview" ? <OverviewPanel id={id} /> : null}
          {tab === "sales" ? <SalesPanel id={id} /> : null}
          {tab === "users" ? <UsersPanel id={id} /> : null}
          {tab === "sessions" ? <SessionsPanel id={id} /> : null}
          {tab === "workstations" ? <WorkstationsPanel id={id} /> : null}
          {tab === "fiscal" ? <FiscalPanel id={id} /> : null}
        </>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewPanel({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-customer-dashboard", id],
    queryFn: () => fetchSaasCustomerDashboard(id),
  });

  if (isLoading && !data) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  // Period-over-period movement for the 30-day window.
  const current = Number(data.sales30d.totalAmount);
  const previous = Number(data.sales30d.previousTotal);
  const pct =
    previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;
  const delta =
    pct === null
      ? undefined
      : {
          label: `${pct >= 0 ? "+" : ""}${pct}%`,
          detail: t("saas.customer.deltaDetail", { value: pct }),
          direction: pct >= 0 ? ("up" as const) : ("down" as const),
          positive: pct >= 0,
        };

  return (
    <Grid container spacing={2}>
      <Grid item xs={12} sm={6} md={3}>
        <KpiCard
          title={t("saas.customer.salesToday")}
          value={formatCop(data.salesToday.totalAmount)}
          subtitle={t("saas.customer.salesTodaySub", {
            count: formatNumber(data.salesToday.count),
          })}
          live
        />
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <KpiCard
          title={t("saas.customer.sales30d")}
          value={formatCop(data.sales30d.totalAmount)}
          delta={delta}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <KpiCard
          title={t("saas.customer.openShifts")}
          value={formatNumber(data.cashShifts.openCount)}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <KpiCard
          title={t("saas.customer.cashDiff30d")}
          value={formatCop(data.cashShifts.differenceAmount30d)}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4}>
        <KpiCard
          title={t("saas.customer.pendingUsers")}
          value={formatNumber(data.users.pendingApproval)}
          tone={data.users.pendingApproval > 0 ? "warning" : "default"}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4}>
        <KpiCard
          title={t("saas.customer.fiscalPending")}
          value={formatNumber(data.fiscal.pending)}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4}>
        <KpiCard
          title={t("saas.customer.fiscalRejected")}
          value={formatNumber(data.fiscal.rejected)}
          tone={data.fiscal.rejected > 0 ? "error" : "default"}
        />
      </Grid>
    </Grid>
  );
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

interface SalesFiltersState {
  from: string;
  to: string;
  state: string;
}

function SalesPanel({ id }: { id: string }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<SalesFiltersState>({
    from: "",
    to: "",
    state: "",
  });

  const apiFilters = useMemo(
    () => ({
      from: filters.from ? dateInputToIso(filters.from) : undefined,
      to: filters.to ? dateInputToIso(filters.to) : undefined,
      state: filters.state || undefined,
    }),
    [filters],
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-customer-sales", id, page, apiFilters],
    queryFn: () => fetchSaasCustomerSales(id, apiFilters, page, PAGE_SIZE),
    placeholderData: (previous) => previous,
  });

  const columns = useMemo<ColumnDef<SaleRow, unknown>[]>(
    () => [
      {
        id: "localNumber",
        header: t("sales.localNumber"),
        accessorKey: "localNumber",
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
        accessorFn: (row) => row.user.fullName,
        cell: (info) => info.row.original.user.fullName,
      },
      {
        id: "operationalState",
        header: t("sales.state"),
        accessorKey: "operationalState",
        cell: (info) => <StatusChip value={info.getValue<string>()} kind="sale" />,
      },
      {
        id: "totalAmount",
        header: t("sales.total"),
        accessorKey: "totalAmount",
        meta: { align: "right" },
        cell: (info) => (
          <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: "tabular-nums" }}>
            {formatCop(info.getValue<string>())}
          </Typography>
        ),
      },
    ],
    [t],
  );

  return (
    <Box>
      <Box display="flex" flexWrap="wrap" gap={2} mb={2}>
        <TextField
          size="small"
          type="date"
          label={t("common.from")}
          value={filters.from}
          onChange={(event) => {
            setFilters((f) => ({ ...f, from: event.target.value }));
            setPage(1);
          }}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 170 }}
        />
        <TextField
          size="small"
          type="date"
          label={t("common.to")}
          value={filters.to}
          onChange={(event) => {
            setFilters((f) => ({ ...f, to: event.target.value }));
            setPage(1);
          }}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 170 }}
        />
        <TextField
          size="small"
          select
          label={t("sales.state")}
          value={filters.state}
          onChange={(event) => {
            setFilters((f) => ({ ...f, state: event.target.value }));
            setPage(1);
          }}
          sx={{ width: 180 }}
        >
          <MenuItem value="">{t("common.all")}</MenuItem>
          {SALE_STATES.map((state) => (
            <MenuItem key={state} value={state}>
              {t(`sales.state${state.charAt(0)}${state.slice(1).toLowerCase()}`)}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      {data ? (
        <Typography variant="caption" color="text.secondary" display="block" mb={1}>
          {t("sales.summary")}: {formatNumber(data.summary.count)} ·{" "}
          {t("sales.summaryTotal")}: {formatCop(data.summary.totalAmount)} ·{" "}
          {t("sales.summaryTax")}: {formatCop(data.summary.totalTax)} ·{" "}
          {t("sales.summaryDiscount")}: {formatCop(data.summary.totalDiscount)}
        </Typography>
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
          getRowId={(row) => row.id}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
          ariaLabel={t("saas.customer.tabsSales")}
        />
      ) : null}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function UsersPanel({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-customer-users", id],
    queryFn: () => fetchSaasCustomerUsers(id),
  });

  const columns = useMemo<ColumnDef<UserListItem, unknown>[]>(
    () => [
      {
        id: "fullName",
        header: t("users.name"),
        accessorKey: "fullName",
      },
      {
        id: "email",
        header: t("users.email"),
        accessorKey: "email",
        cell: (info) => info.getValue<string | null>() ?? "—",
      },
      {
        id: "role",
        header: t("users.role"),
        accessorKey: "role",
      },
      {
        id: "status",
        header: t("saas.columns.status"),
        accessorKey: "status",
        cell: (info) => <StatusChip value={info.getValue<string>()} kind="user" />,
      },
      {
        id: "lastLoginAt",
        header: t("users.lastLogin"),
        accessorKey: "lastLoginAt",
        cell: (info) => formatDateTime(info.getValue<string | null>()),
      },
    ],
    [t],
  );

  if (isLoading && !data) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <DataTable
      columns={columns}
      data={data.users}
      total={data.total}
      page={1}
      pageSize={PAGE_SIZE}
      totalPages={totalPages}
      onPageChange={() => undefined}
      getRowId={(row) => row.id}
      ariaLabel={t("saas.customer.tabsUsers")}
    />
  );
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function SessionsPanel({ id }: { id: string }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-customer-sessions", id, page],
    queryFn: () => fetchSaasCustomerSessions(id, page, PAGE_SIZE),
    placeholderData: (previous) => previous,
  });

  const columns = useMemo<ColumnDef<SessionRow, unknown>[]>(
    () => [
      {
        id: "user",
        header: t("sessions.user"),
        accessorFn: (row) => row.user.fullName,
        cell: (info) => info.row.original.user.fullName,
      },
      {
        id: "workstation",
        header: t("sessions.workstation"),
        accessorFn: (row) => row.workstation.code,
        cell: (info) => info.row.original.workstation.code,
      },
      {
        id: "ipAddress",
        header: t("sessions.ip"),
        accessorKey: "ipAddress",
        cell: (info) => info.getValue<string | null>() ?? "—",
      },
      {
        id: "deviceInfo",
        header: t("sessions.device"),
        accessorKey: "deviceInfo",
        cell: (info) => info.getValue<string | null>() ?? "—",
      },
      {
        id: "lastActivityAt",
        header: t("sessions.lastActivity"),
        accessorKey: "lastActivityAt",
        cell: (info) => formatDateTime(info.getValue<string>()),
      },
      {
        id: "expiresAt",
        header: t("sessions.expiresAt"),
        accessorKey: "expiresAt",
        cell: (info) => formatDateTime(info.getValue<string>()),
      },
    ],
    [t],
  );

  return isLoading && !data ? (
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
      isError={isError}
      onRetry={() => void refetch()}
      ariaLabel={t("saas.customer.tabsSessions")}
    />
  ) : null;
}

// ---------------------------------------------------------------------------
// Workstations
// ---------------------------------------------------------------------------

function WorkstationsPanel({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-customer-workstations", id],
    queryFn: () => fetchSaasCustomerWorkstations(id),
  });

  const columns = useMemo<ColumnDef<WorkstationRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: t("workstations.name"),
        accessorKey: "name",
      },
      {
        id: "code",
        header: t("workstations.code"),
        accessorKey: "code",
      },
      {
        id: "isActive",
        header: t("workstations.isActive"),
        accessorKey: "isActive",
        cell: (info) =>
          info.getValue<boolean>() ? t("workstations.online") : t("workstations.offline"),
      },
      {
        id: "activeSessions",
        header: t("workstations.activeSessions"),
        accessorKey: "activeSessions",
        meta: { align: "right" },
      },
      {
        id: "salesToday",
        header: t("workstations.salesToday"),
        accessorKey: "salesToday",
        meta: { align: "right" },
      },
      {
        id: "lastSeenAt",
        header: t("workstations.lastSeenAt"),
        accessorKey: "lastSeenAt",
        cell: (info) => formatDateTime(info.getValue<string | null>()),
      },
    ],
    [t],
  );

  if (isLoading && !data) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  const rows = data.workstations;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  return (
    <>
      <Typography variant="caption" color="text.secondary" display="block" mb={1}>
        {t("workstations.activeSessionCount")}: {formatNumber(data.activeSessionCount)}
      </Typography>
      <DataTable
        columns={columns}
        data={rows}
        total={rows.length}
        page={1}
        pageSize={Math.max(rows.length, 1)}
        totalPages={totalPages}
        onPageChange={() => undefined}
        getRowId={(row) => row.id}
        ariaLabel={t("saas.customer.tabsWorkstations")}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Fiscal
// ---------------------------------------------------------------------------

function FiscalPanel({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-customer-fiscal", id],
    queryFn: () => fetchSaasCustomerFiscalStatus(id),
  });

  const columns = useMemo<ColumnDef<RecentRejectedDocument, unknown>[]>(
    () => [
      {
        id: "fullNumber",
        header: t("fiscal.fullNumber"),
        accessorKey: "fullNumber",
      },
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
        id: "issueDate",
        header: t("fiscal.issueDate"),
        accessorKey: "issueDate",
        cell: (info) => formatDate(info.getValue<string>()),
      },
      {
        id: "fiscalState",
        header: t("fiscal.fiscalState"),
        accessorKey: "fiscalState",
        cell: (info) => <StatusChip value={info.getValue<string>()} kind="fiscal" />,
      },
      {
        id: "retryCount",
        header: t("fiscal.retryCount"),
        accessorKey: "retryCount",
        meta: { align: "right" },
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

  if (isLoading && !data) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  const rejected = data.recentRejected;
  const totalPages = Math.max(1, Math.ceil(rejected.length / PAGE_SIZE));

  return (
    <>
      <FiscalStateBar counts={data.countsByState} />
      <Typography variant="overline" component="h2" color="text.secondary">
        {t("fiscal.recentRejected")}
      </Typography>
      <DataTable
        columns={columns}
        data={rejected}
        total={rejected.length}
        page={1}
        pageSize={Math.max(rejected.length, 1)}
        totalPages={totalPages}
        onPageChange={() => undefined}
        getRowId={(row) => row.id}
        emptyMessage={t("inventory.none")}
        ariaLabel={t("fiscal.recentRejected")}
      />
    </>
  );
}
