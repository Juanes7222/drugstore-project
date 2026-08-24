import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { fetchSubscriptions } from "../services/backoffice";
import { formatDate } from "../utils/format";
import type { SubscriptionRow } from "../types/backoffice";
import { PageHeader } from "../components/common/page-header";
import { DataTable } from "../components/tables/data-table";
import { StatusChip } from "../components/common/status-chip";
import { LoadingState, ErrorState } from "../components/common/states";

const PAGE_SIZE = 20;

export function SubscriptionsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["subscriptions", page],
    queryFn: () => fetchSubscriptions(page, PAGE_SIZE),
    placeholderData: (previous) => previous,
  });

  const columns = useMemo<ColumnDef<SubscriptionRow, unknown>[]>(
    () => [
      {
        id: "customer",
        header: t("subscriptions.customer"),
        accessorKey: "customerName",
        cell: (info) => (
          <Typography variant="body2" fontWeight={600}>
            {info.getValue<string>()}
          </Typography>
        ),
      },
      {
        id: "customerTaxId",
        header: t("subscriptions.taxId"),
        accessorKey: "customerTaxId",
        cell: (info) => info.getValue<string | null>() ?? "—",
      },
      {
        id: "customerEmail",
        header: t("subscriptions.email"),
        accessorKey: "customerEmail",
        cell: (info) => info.getValue<string | null>() ?? "—",
      },
      {
        id: "plan",
        header: t("subscriptions.plan"),
        accessorKey: "plan",
        cell: (info) => {
          const plan = info.getValue<SubscriptionRow["plan"]>();
          return `${plan.name} (${plan.code})`;
        },
      },
      {
        id: "status",
        header: t("subscriptions.status"),
        accessorKey: "status",
        cell: (info) => (
          <StatusChip value={info.getValue<string>()} kind="subscription" />
        ),
      },
      {
        id: "currentPeriodStart",
        header: t("subscriptions.periodStart"),
        accessorKey: "currentPeriodStart",
        cell: (info) => formatDate(info.getValue<string | null>()),
      },
      {
        id: "currentPeriodEnd",
        header: t("subscriptions.periodEnd"),
        accessorKey: "currentPeriodEnd",
        cell: (info) => formatDate(info.getValue<string | null>()),
      },
      {
        id: "trialEndsAt",
        header: t("subscriptions.trialEndsAt"),
        accessorKey: "trialEndsAt",
        cell: (info) => formatDate(info.getValue<string | null>()),
      },
      {
        id: "cancelAtPeriodEnd",
        header: t("subscriptions.cancelAtPeriodEnd"),
        accessorKey: "cancelAtPeriodEnd",
        meta: { align: "right" },
        cell: (info) =>
          info.getValue<boolean>() ? t("common.yes") : t("common.no"),
      },
      {
        id: "locations",
        header: t("subscriptions.locations"),
        accessorKey: "_count",
        meta: { align: "right" },
        cell: (info) => info.getValue<SubscriptionRow["_count"]>().locations,
      },
      {
        id: "activations",
        header: t("subscriptions.activations"),
        accessorKey: "_count",
        meta: { align: "right" },
        cell: (info) =>
          info.getValue<SubscriptionRow["_count"]>().workstationActivations,
      },
      {
        id: "fraudAlerts",
        header: t("subscriptions.fraudAlerts"),
        accessorKey: "_count",
        meta: { align: "right" },
        cell: (info) => info.getValue<SubscriptionRow["_count"]>().fraudAlerts,
      },
    ],
    [t],
  );

  return (
    <Box>
      <PageHeader
        title={t("subscriptions.title")}
        subtitle={t("subscriptions.subtitle")}
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
