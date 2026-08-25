import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import axios from "axios";
import type { ColumnDef } from "@tanstack/react-table";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import Menu from "@mui/material/Menu";
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
import type { SaasAdminCustomerPaymentRow } from "../../types/saas-admin";
import {
  dateInputToIso,
  formatCop,
  formatDate,
  formatDateTime,
  formatNumber,
} from "../../utils/format";
import {
  changeSaasCustomerPlan,
  extendSaasCustomerTrial,
  fetchSaasCustomerPayments,
  fetchSaasPlanOptions,
  reactivateSaasCustomer,
  suspendSaasCustomer,
} from "../../services/saas-admin";
import { Alert } from "@mui/material";
import { KpiCard } from "../../components/common/kpi-card";
import { PageHeader } from "../../components/common/page-header";
import { DataTable } from "../../components/tables/data-table";
import { StatusChip } from "../../components/common/status-chip";
import { FiscalStateBar } from "../../components/charts/fiscal-state-bar";
import { SalesTrendChart } from "../../components/charts/sales-trend-chart";
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

type ActionDialogKind = "suspend" | "reactivate" | "plan" | "trial" | null;

function lifecycleErrorCode(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    return (
      (error.response?.data as { errorCode?: string } | undefined)?.errorCode ??
      null
    );
  }
  return null;
}

function CustomerDetailContent({ id }: { id: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<SaasAdminTabKey>("overview");
  const [actionsAnchor, setActionsAnchor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<ActionDialogKind>(null);
  const [planCode, setPlanCode] = useState("");
  const [trialDays, setTrialDays] = useState("15");
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: customer, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-customer", id],
    queryFn: () => fetchSaasCustomer(id),
  });

  const plansQuery = useQuery({
    queryKey: ["saas-plan-options"],
    queryFn: fetchSaasPlanOptions,
    enabled: dialog === "plan",
  });

  const closeDialog = () => {
    setDialog(null);
    setActionError(null);
  };

  // Lifecycle actions return the refreshed row; patch the detail cache and
  // invalidate every list that shows status-derived numbers.
  const lifecycleMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      switch (dialog) {
        case "suspend":
          await suspendSaasCustomer(id);
          break;
        case "reactivate":
          await reactivateSaasCustomer(id);
          break;
        case "plan":
          await changeSaasCustomerPlan(id, planCode);
          break;
        case "trial": {
          const days = Number(trialDays);
          if (!Number.isInteger(days) || days < 1 || days > 90) {
            throw new Error("invalid-days");
          }
          await extendSaasCustomerTrial(id, days);
          break;
        }
        default:
          break;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["saas-customer", id] });
      void queryClient.invalidateQueries({ queryKey: ["saas-customers"] });
      void queryClient.invalidateQueries({ queryKey: ["saas-platform-overview"] });
      void queryClient.invalidateQueries({ queryKey: ["saas-trials-ending"] });
      closeDialog();
    },
    onError: (error) => {
      if (error instanceof Error && error.message === "invalid-days") {
        setActionError(t("saas.actions.errDays"));
        return;
      }
      const code = lifecycleErrorCode(error);
      setActionError(
        code === "SUBSCRIPTION_CANNOT_REACTIVATE"
          ? t("saas.actions.errReactivate")
          : code === "SUBSCRIPTION_NOT_IN_TRIAL"
            ? t("saas.actions.errNotTrial")
            : code === "PLAN_NOT_FOUND"
              ? t("saas.actions.errPlan")
              : t("common.error"),
      );
    },
  });

  const isSuspended = customer?.status === "SUSPENDED";
  const isPastDue = customer?.status === "PAST_DUE";
  const isTrial = customer?.status === "TRIAL";

  const tabs: { key: SaasAdminTabKey; label: string }[] = [
    { key: "overview", label: t("saas.customer.tabsOverview") },
    { key: "sales", label: t("saas.customer.tabsSales") },
    { key: "payments", label: t("saas.customer.tabsPayments") },
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
            actions={
              <Box display="flex" alignItems="center" gap={1.5}>
                <StatusChip value={customer.status} kind="subscription" />
                <Button
                  variant="outlined"
                  size="small"
                  onClick={(event) => setActionsAnchor(event.currentTarget)}
                  aria-haspopup="menu"
                  aria-expanded={actionsAnchor !== null}
                >
                  {t("saas.actions.manage")}
                </Button>
                <Menu
                  anchorEl={actionsAnchor}
                  open={actionsAnchor !== null}
                  onClose={() => setActionsAnchor(null)}
                >
                  {isSuspended || isPastDue ? (
                    <MenuItem
                      onClick={() => {
                        setActionsAnchor(null);
                        setDialog("reactivate");
                      }}
                    >
                      {t("saas.actions.reactivate")}
                    </MenuItem>
                  ) : null}
                  {isTrial ? (
                    <MenuItem
                      onClick={() => {
                        setActionsAnchor(null);
                        setTrialDays("15");
                        setDialog("trial");
                      }}
                    >
                      {t("saas.actions.extendTrial")}
                    </MenuItem>
                  ) : null}
                  <MenuItem
                    onClick={() => {
                      setActionsAnchor(null);
                      setPlanCode(customer.plan.code);
                      setDialog("plan");
                    }}
                  >
                    {t("saas.actions.changePlan")}
                  </MenuItem>
                  {!isSuspended ? (
                    <MenuItem
                      onClick={() => {
                        setActionsAnchor(null);
                        setDialog("suspend");
                      }}
                    >
                      {t("saas.actions.suspend")}
                    </MenuItem>
                  ) : null}
                </Menu>
              </Box>
            }
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
          {tab === "payments" ? <PaymentsPanel id={id} /> : null}
          {tab === "users" ? <UsersPanel id={id} /> : null}
          {tab === "sessions" ? <SessionsPanel id={id} /> : null}
          {tab === "workstations" ? <WorkstationsPanel id={id} /> : null}
          {tab === "fiscal" ? <FiscalPanel id={id} /> : null}

          {/* Lifecycle dialogs — one generic shell, per-kind body. */}
          <Dialog
            open={dialog === "suspend" || dialog === "reactivate"}
            onClose={closeDialog}
            aria-labelledby="lifecycle-dialog-title"
          >
            <DialogTitle id="lifecycle-dialog-title">
              {dialog === "suspend"
                ? t("saas.actions.suspendConfirmTitle")
                : t("saas.actions.reactivateConfirmTitle")}
            </DialogTitle>
            <DialogContent>
              {actionError ? (
                <Alert severity="error" role="alert" sx={{ mb: 1 }}>
                  {actionError}
                </Alert>
              ) : null}
              <Typography variant="body2" color="text.secondary">
                {t("saas.actions.confirmMessage", {
                  customer: customer?.customerName ?? "",
                })}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={closeDialog}>{t("common.cancel")}</Button>
              <Button
                variant="contained"
                color={dialog === "suspend" ? "error" : "primary"}
                disabled={lifecycleMutation.isPending}
                onClick={() => lifecycleMutation.mutate()}
              >
                {t("common.confirm")}
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog
            open={dialog === "plan"}
            onClose={closeDialog}
            aria-labelledby="plan-dialog-title"
          >
            <DialogTitle id="plan-dialog-title">
              {t("saas.actions.changePlan")}
            </DialogTitle>
            <DialogContent sx={{ minWidth: 320 }}>
              {actionError ? (
                <Alert severity="error" role="alert" sx={{ mb: 1 }}>
                  {actionError}
                </Alert>
              ) : null}
              <TextField
                select
                fullWidth
                label={t("saas.columns.plan")}
                value={planCode}
                onChange={(event) => setPlanCode(event.target.value)}
                disabled={plansQuery.isLoading}
              >
                {(plansQuery.data ?? []).map((plan) => (
                  <MenuItem key={plan.id} value={plan.code}>
                    {plan.name}
                  </MenuItem>
                ))}
              </TextField>
            </DialogContent>
            <DialogActions>
              <Button onClick={closeDialog}>{t("common.cancel")}</Button>
              <Button
                variant="contained"
                disabled={!planCode || lifecycleMutation.isPending}
                onClick={() => lifecycleMutation.mutate()}
              >
                {t("common.confirm")}
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog
            open={dialog === "trial"}
            onClose={closeDialog}
            aria-labelledby="trial-dialog-title"
          >
            <DialogTitle id="trial-dialog-title">
              {t("saas.actions.extendTrial")}
            </DialogTitle>
            <DialogContent sx={{ minWidth: 280 }}>
              {actionError ? (
                <Alert severity="error" role="alert" sx={{ mb: 1 }}>
                  {actionError}
                </Alert>
              ) : null}
              <TextField
                type="number"
                fullWidth
                label={t("saas.actions.trialDays")}
                value={trialDays}
                inputProps={{ min: 1, max: 90 }}
                onChange={(event) => setTrialDays(event.target.value)}
                helperText={t("saas.actions.trialDaysHint")}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={closeDialog}>{t("common.cancel")}</Button>
              <Button
                variant="contained"
                disabled={lifecycleMutation.isPending}
                onClick={() => lifecycleMutation.mutate()}
              >
                {t("common.confirm")}
              </Button>
            </DialogActions>
          </Dialog>
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

  // The shared chart expects the tenant dashboard's day shape; the saas
  // trend uses count/totalAmount naming.
  const trendDays = data.salesTrend.days.map((day) => ({
    date: day.date,
    confirmedCount: day.count,
    confirmedAmount: day.totalAmount,
  }));
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
    <>
      <SalesTrendChart days={trendDays} />
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
    </>
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
// Payments
// ---------------------------------------------------------------------------

function PaymentsPanel({ id }: { id: string }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-customer-payments", id, page],
    queryFn: () => fetchSaasCustomerPayments(id, page, PAGE_SIZE),
    placeholderData: (previous) => previous,
  });

  const columns = useMemo<ColumnDef<SaasAdminCustomerPaymentRow, unknown>[]>(
    () => [
      {
        id: "recordedAt",
        header: t("saas.payments.recordedAt"),
        accessorKey: "recordedAt",
        cell: (info) => formatDateTime(info.getValue<string>()),
      },
      {
        id: "amount",
        header: t("sales.total"),
        accessorKey: "amount",
        meta: { align: "right" },
        cell: (info) => (
          <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: "tabular-nums" }}>
            {formatCop(info.getValue<string>())}
          </Typography>
        ),
      },
      {
        id: "currency",
        header: t("saas.payments.currency"),
        accessorKey: "currency",
      },
      {
        id: "method",
        header: t("saas.payments.method"),
        accessorKey: "method",
        cell: (info) => info.getValue<string | null>() ?? "—",
      },
      {
        id: "externalReference",
        header: t("saas.payments.reference"),
        accessorKey: "externalReference",
        cell: (info) => (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: "-webkit-box",
              WebkitLineClamp: 1,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              maxWidth: 220,
            }}
          >
            {info.getValue<string | null>() ?? "—"}
          </Typography>
        ),
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
      emptyMessage={t("common.empty")}
      ariaLabel={t("saas.customer.tabsPayments")}
    />
  ) : null;
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
