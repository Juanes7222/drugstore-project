import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import BlockIcon from "@mui/icons-material/Block";
import { fetchSessions, revokeSession } from "../services/backoffice";
import { formatDateTime } from "../utils/format";
import type { SessionRow } from "../types/backoffice";
import { PageHeader } from "../components/common/page-header";
import { DataTable } from "../components/tables/data-table";
import { ConfirmDialog } from "../components/common/confirm-dialog";
import { LoadingState, ErrorState } from "../components/common/states";

const PAGE_SIZE = 20;

export function SessionsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pendingRevoke, setPendingRevoke] = useState<SessionRow | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["sessions", page],
    queryFn: () => fetchSessions(page, PAGE_SIZE),
    placeholderData: (previous) => previous,
  });

  const revokeMutation = useMutation({
    mutationFn: (session: SessionRow) =>
      revokeSession(session.userId, session.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["user-sessions"] });
      setSnackbar(t("sessions.revoked"));
    },
  });

  const columns = useMemo<ColumnDef<SessionRow, unknown>[]>(
    () => [
      {
        id: "user",
        header: t("sessions.user"),
        accessorKey: "user",
        cell: (info) => {
          const user = info.getValue<SessionRow["user"]>();
          return (
            <Box>
              <Typography variant="body2" fontWeight={600} noWrap>
                {user.displayName ?? user.fullName}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {user.email ?? ""} · {user.role}
              </Typography>
            </Box>
          );
        },
      },
      {
        id: "workstation",
        header: t("sessions.workstation"),
        accessorKey: "workstation",
        cell: (info) => {
          const ws = info.getValue<SessionRow["workstation"]>();
          return `${ws.name} (${ws.code})`;
        },
      },
      {
        id: "ipAddress",
        header: t("sessions.ip"),
        accessorKey: "ipAddress",
        cell: (info) => info.getValue<string | null>() ?? "—",
      },
      {
        id: "geo",
        header: t("sessions.geo"),
        accessorKey: "geoCountry",
        cell: (info) => {
          const row = info.row.original;
          return (
            [row.geoCountry, row.geoCity].filter(Boolean).join(", ") || "—"
          );
        },
      },
      {
        id: "deviceInfo",
        header: t("sessions.device"),
        accessorKey: "deviceInfo",
        cell: (info) => (
          <Typography variant="body2" noWrap sx={{ maxWidth: 220 }}>
            {info.getValue<string | null>() ?? "—"}
          </Typography>
        ),
      },
      {
        id: "issuedAt",
        header: t("sessions.issuedAt"),
        accessorKey: "issuedAt",
        cell: (info) => formatDateTime(info.getValue<string>()),
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
      {
        id: "actions",
        header: t("common.actions"),
        enableSorting: false,
        cell: (info) => (
          <Tooltip title={t("sessions.revoke")}>
            <IconButton
              size="small"
              color="error"
              onClick={() => setPendingRevoke(info.row.original)}
              aria-label={t("sessions.revoke")}
            >
              <BlockIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [t],
  );

  return (
    <Box>
      <PageHeader
        title={t("sessions.title")}
        subtitle={t("sessions.subtitle")}
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

      <ConfirmDialog
        open={pendingRevoke !== null}
        title={t("sessions.revoke")}
        message={t("sessions.confirmRevoke")}
        severity="error"
        onConfirm={() => {
          if (pendingRevoke) revokeMutation.mutate(pendingRevoke);
        }}
        onClose={() => setPendingRevoke(null)}
      />

      <Snackbar
        open={snackbar !== null}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity="success"
          variant="filled"
          onClose={() => setSnackbar(null)}
        >
          {snackbar}
        </Alert>
      </Snackbar>
    </Box>
  );
}
