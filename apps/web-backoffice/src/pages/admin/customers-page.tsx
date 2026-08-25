import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import InputAdornment from "@mui/material/InputAdornment";
import {
  fetchSaasCustomers,
} from "../../services/saas-admin";
import type { SaasAdminCustomerRow } from "../../types/saas-admin";
import { formatDate, formatDateTime } from "../../utils/format";
import { PageHeader } from "../../components/common/page-header";
import { ExportButton } from "../../components/common/export-button";
import { DataTable } from "../../components/tables/data-table";
import { StatusChip } from "../../components/common/status-chip";
import { LoadingState, ErrorState } from "../../components/common/states";
import { SearchIcon, XIcon } from "../../components/icons/app-icons";

const PAGE_SIZE = 20;

/** Small debounce so typing in the search box does not spam the API. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function CustomersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search.trim(), 300);

  // Reset to the first page whenever the filter changes.
  useEffect(() => {
    setPage(1);
  }, [query]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saas-customers", page, query],
    queryFn: () => fetchSaasCustomers(page, PAGE_SIZE, query || undefined),
    placeholderData: (previous) => previous,
  });

  const columns = useMemo<ColumnDef<SaasAdminCustomerRow, unknown>[]>(
    () => [
      {
        id: "customer",
        header: t("saas.columns.customer"),
        accessorKey: "customerName",
        cell: (info) => (
          <Button
            variant="text"
            size="small"
            sx={{ px: 0, textTransform: "none", fontWeight: 600, justifyContent: "flex-start" }}
            onClick={() => navigate(`/admin/customers/${info.row.original.id}`)}
            aria-label={t("saas.openDetail")}
          >
            {info.getValue<string>()}
          </Button>
        ),
      },
      {
        id: "customerTaxId",
        header: t("saas.columns.taxId"),
        accessorKey: "customerTaxId",
      },
      {
        id: "customerEmail",
        header: t("saas.columns.email"),
        accessorKey: "customerEmail",
        cell: (info) => info.getValue<string | null>() ?? "—",
      },
      {
        id: "plan",
        header: t("saas.columns.plan"),
        accessorKey: "plan",
        cell: (info) => info.getValue<SaasAdminCustomerRow["plan"]>().name,
      },
      {
        id: "status",
        header: t("saas.columns.status"),
        accessorKey: "status",
        cell: (info) => (
          <StatusChip value={info.getValue<string>()} kind="subscription" />
        ),
      },
      {
        id: "currentPeriodEnd",
        header: t("saas.columns.periodEnd"),
        accessorKey: "currentPeriodEnd",
        cell: (info) => formatDate(info.getValue<string>()),
      },
      {
        id: "lastActivityAt",
        header: t("saas.customer.lastActivity"),
        accessorKey: "lastActivityAt",
        cell: (info) => formatDateTime(info.getValue<string | null>()),
      },
      {
        id: "activations",
        header: t("saas.columns.activations"),
        accessorKey: "_count",
        meta: { align: "right" },
        cell: (info) =>
          info.getValue<SaasAdminCustomerRow["_count"]>().workstationActivations,
      },
      {
        id: "fraudAlerts",
        header: t("saas.columns.fraudAlerts"),
        accessorKey: "_count",
        meta: { align: "right" },
        cell: (info) => {
          const alerts = info.getValue<SaasAdminCustomerRow["_count"]>().fraudAlerts;
          return (
            <Typography
              variant="body2"
              color={alerts > 0 ? "error.main" : undefined}
              sx={{ fontVariantNumeric: "tabular-nums" }}
            >
              {alerts}
            </Typography>
          );
        },
      },
    ],
    [t, navigate],
  );

  return (
    <Box>
      <PageHeader
        title={t("saas.customersTitle")}
        subtitle={t("saas.customersSubtitle")}
        actions={
          <>
            <ExportButton
              path="/saas-admin/customers/export"
              params={{ query: query || undefined }}
              fallbackName="saas-customers"
            />
            <TextField
            size="small"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("saas.searchPlaceholder")}
            aria-label={t("saas.searchPlaceholder")}
            sx={{ width: { xs: "100%", sm: 320 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon size={16} aria-hidden />
                </InputAdornment>
              ),
              endAdornment: search ? (
                <InputAdornment position="end">
                  <Button
                    aria-label={t("common.clearFilters")}
                    onClick={() => setSearch("")}
                    sx={{ minWidth: 0, p: 0.5 }}
                  >
                    <XIcon size={14} aria-hidden />
                  </Button>
                </InputAdornment>
              ) : null,
            }}
          />
          </>
        }
      />

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
          emptyMessage={t("common.empty")}
          ariaLabel={t("saas.customersTitle")}
        />
      ) : null}
    </Box>
  );
}
