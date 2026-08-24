import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import {
  HowToRegIcon,
  BlockIcon,
  CheckCircleIcon,
  LockOpenIcon,
  DevicesIcon,
} from "../components/icons/app-icons";
import {
  fetchUsers,
  fetchUserSessions,
  approveUser,
  disableUser,
  enableUser,
  unlockUser,
  revokeSession,
} from "../services/backoffice";
import { formatDateTime } from "../utils/format";
import type { UserListItem, UserSessionSummary } from "../types/backoffice";
import { PageHeader } from "../components/common/page-header";
import { DataTable } from "../components/tables/data-table";
import { StatusChip } from "../components/common/status-chip";
import { ConfirmDialog } from "../components/common/confirm-dialog";
import { LoadingState, ErrorState } from "../components/common/states";

const USER_STATUSES = ["ALL", "PENDING_SETUP", "ACTIVE", "DISABLED", "LOCKED"];
const PAGE_SIZE = 20;

type UserAction = "approve" | "disable" | "enable" | "unlock";

interface PendingAction {
  user: UserListItem;
  action: UserAction;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function UsersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [sessionsUser, setSessionsUser] = useState<UserListItem | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["users", { status: statusFilter, page }],
    queryFn: () =>
      fetchUsers(
        statusFilter === "ALL" ? {} : { status: statusFilter },
        page,
        PAGE_SIZE,
      ),
    placeholderData: (previous) => previous,
  });

  const invalidateUsers = () => {
    void queryClient.invalidateQueries({ queryKey: ["users"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const userMutation = useMutation({
    mutationFn: async ({ user, action }: PendingAction) => {
      switch (action) {
        case "approve":
          return approveUser(user.id);
        case "disable":
          return disableUser(user.id);
        case "enable":
          return enableUser(user.id);
        case "unlock":
          return unlockUser(user.id);
      }
    },
    onSuccess: () => {
      invalidateUsers();
      setSnackbar(t("users.userUpdated"));
    },
  });

  const sessionRevokeMutation = useMutation({
    mutationFn: (sessionId: string) =>
      revokeSession(sessionsUser!.id, sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["user-sessions", sessionsUser?.id],
      });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setSnackbar(t("users.revoked"));
    },
  });

  const actionLabel = (action: UserAction): string => t(`users.${action}`);

  const actionConfirmMessage = (action: UserAction, name: string): string => {
    switch (action) {
      case "approve":
        return t("users.confirmApprove", { name });
      case "disable":
        return t("users.confirmDisable", { name });
      case "enable":
        return t("users.confirmEnable", { name });
      case "unlock":
        return t("users.confirmUnlock", { name });
    }
  };

  const columns = useMemo<ColumnDef<UserListItem, unknown>[]>(
    () => [
      {
        id: "name",
        header: t("users.name"),
        accessorKey: "displayName",
        cell: (info) => {
          const user = info.row.original;
          return (
            <Box display="flex" alignItems="center" gap={1.5}>
              <Avatar sx={{ width: 28, height: 28, bgcolor: "primary.main" }}>
                {initialsOf(user.displayName ?? user.fullName ?? "?")}
              </Avatar>
              <Box minWidth={0}>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {user.displayName ?? user.fullName}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {user.username ?? ""}
                </Typography>
              </Box>
            </Box>
          );
        },
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
        cell: (info) => (
          <Typography variant="body2">{info.getValue<string>()}</Typography>
        ),
      },
      {
        id: "status",
        header: t("statusFilter"),
        accessorKey: "status",
        cell: (info) => (
          <StatusChip value={info.getValue<string>()} kind="user" />
        ),
      },
      {
        id: "lastLoginAt",
        header: t("users.lastLogin"),
        accessorKey: "lastLoginAt",
        cell: (info) => formatDateTime(info.getValue<string | null>()),
      },
      {
        id: "createdAt",
        header: t("users.createdAt"),
        accessorKey: "createdAt",
        cell: (info) => formatDateTime(info.getValue<string>()),
      },
      {
        id: "actions",
        header: t("common.actions"),
        enableSorting: false,
        cell: (info) => {
          const user = info.row.original;
          return (
            <Box display="flex" gap={0.5}>
              {user.status === "PENDING_SETUP" ? (
                <Tooltip title={t("users.approve")}>
                  <IconButton
                    size="small"
                    color="success"
                    onClick={() =>
                      setPendingAction({ user, action: "approve" })
                    }
                    aria-label={t("users.approve")}
                  >
                    <HowToRegIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
              {user.status === "LOCKED" ? (
                <Tooltip title={t("users.unlock")}>
                  <IconButton
                    size="small"
                    color="warning"
                    onClick={() => setPendingAction({ user, action: "unlock" })}
                    aria-label={t("users.unlock")}
                  >
                    <LockOpenIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
              {user.status !== "DISABLED" && user.status !== "PENDING_SETUP" ? (
                <Tooltip title={t("users.disable")}>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() =>
                      setPendingAction({ user, action: "disable" })
                    }
                    aria-label={t("users.disable")}
                  >
                    <BlockIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
              {user.status === "DISABLED" ? (
                <Tooltip title={t("users.enable")}>
                  <IconButton
                    size="small"
                    color="success"
                    onClick={() => setPendingAction({ user, action: "enable" })}
                    aria-label={t("users.enable")}
                  >
                    <CheckCircleIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
              <Tooltip title={t("users.sessions")}>
                <IconButton
                  size="small"
                  color="info"
                  onClick={() => setSessionsUser(user)}
                  aria-label={t("users.sessions")}
                >
                  <DevicesIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          );
        },
      },
    ],
    [t],
  );

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <Box>
      <PageHeader title={t("users.title")} subtitle={t("users.subtitle")} />

      <Box display="flex" gap={2} mb={3}>
        <TextField
          select
          label={t("users.statusFilter")}
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          size="small"
          sx={{ minWidth: 220 }}
        >
          {USER_STATUSES.map((status) => (
            <MenuItem key={status} value={status}>
              {status === "ALL"
                ? t("common.all")
                : t(`status.${status}`, { defaultValue: status })}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      {isLoading && !data ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : data ? (
        <DataTable
          columns={columns}
          data={data.users}
          total={data.total}
          page={page}
          pageSize={PAGE_SIZE}
          totalPages={totalPages}
          onPageChange={setPage}
          onPageSizeChange={() => undefined}
          getRowId={(row) => row.id}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
        />
      ) : null}

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction ? actionLabel(pendingAction.action) : ""}
        message={
          pendingAction
            ? actionConfirmMessage(
                pendingAction.action,
                pendingAction.user.displayName ?? pendingAction.user.fullName,
              )
            : ""
        }
        confirmLabel={
          pendingAction ? actionLabel(pendingAction.action) : undefined
        }
        severity={pendingAction?.action === "disable" ? "error" : "warning"}
        onConfirm={() => {
          if (pendingAction) userMutation.mutate(pendingAction);
        }}
        onClose={() => setPendingAction(null)}
      />

      <UserSessionsDialog
        user={sessionsUser}
        onClose={() => setSessionsUser(null)}
        onRevoke={(sessionId) => sessionRevokeMutation.mutate(sessionId)}
        revoking={sessionRevokeMutation.isPending}
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

interface UserSessionsDialogProps {
  user: UserListItem | null;
  onClose: () => void;
  onRevoke: (sessionId: string) => void;
  revoking: boolean;
}

function UserSessionsDialog({
  user,
  onClose,
  onRevoke,
  revoking,
}: UserSessionsDialogProps) {
  const { t } = useTranslation();
  const { data: sessions, isLoading } = useQuery({
    queryKey: ["user-sessions", user?.id],
    queryFn: () => fetchUserSessions(user!.id),
    enabled: user !== null,
  });

  return (
    <Dialog
      open={user !== null}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="user-sessions-title"
    >
      <DialogTitle id="user-sessions-title">
        {user
          ? t("users.sessionTitle", { name: user.displayName ?? user.fullName })
          : ""}
      </DialogTitle>
      <DialogContent dividers>
        {isLoading ? (
          <LoadingState />
        ) : sessions && sessions.length > 0 ? (
          <List disablePadding>
            {sessions.map((session) => (
              <SessionRowItem
                key={session.id}
                session={session}
                onRevoke={() => onRevoke(session.id)}
                revoking={revoking}
              />
            ))}
          </List>
        ) : (
          <Typography
            variant="body2"
            color="text.secondary"
            py={3}
            textAlign="center"
          >
            {t("users.noSessions")}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.close")}</Button>
      </DialogActions>
    </Dialog>
  );
}

function SessionRowItem({
  session,
  onRevoke,
  revoking,
}: {
  session: UserSessionSummary;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ListItem
      divider
      secondaryAction={
        <Tooltip title={t("users.revoke")}>
          <IconButton
            edge="end"
            size="small"
            color="error"
            onClick={onRevoke}
            disabled={revoking}
            aria-label={t("users.revoke")}
          >
            <BlockIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      }
    >
      <ListItemText
        primary={
          <Typography variant="body2">
            {session.deviceInfo || session.ipAddress || session.workstationId}
          </Typography>
        }
        secondary={
          <>
            {t("sessions.issuedAt")}: {formatDateTime(session.issuedAt)}
            {" · "}
            {t("sessions.lastActivity")}:{" "}
            {formatDateTime(session.lastActivityAt)}
            {" · "}
            {t("sessions.expiresAt")}: {formatDateTime(session.expiresAt)}
          </>
        }
      />
    </ListItem>
  );
}
