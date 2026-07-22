/**
 * User management page (manager/owner only).
 *
 * Thin wiring container: owns state, side-effects, and action handlers.
 * Presentational sub-components are imported from sibling files.
 *
 * Lists users with avatar, display name, role, status, last login.
 * Filter by role, status.
 * Per-user actions: disable, enable, reset PIN.
 *
 * @category Page
 */

import { type FC, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@/utils/notify";
import { useLocalSessionStore, hasMinRole } from "../../../domain/auth/local-session.store";
import { createAuthService, type AuthService } from "../../../domain/auth/auth.service";
import { API_BASE_URL } from "@infra/config";
import { RoleType } from "@pharmacy/shared-types";
import { UserTable } from "./user-table";
import { CreateUserModal } from "./create-user-modal";
import { EditUserModal } from "./edit-user-modal";
import { DeleteUserDialog } from "./delete-user-dialog";
import { SetPinDialog } from "./set-pin-dialog";
import type { UserRow, NewUserForm, EditUserFormData } from "./user-management.types";

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export const UserManagementPage: FC = () => {
  const { t } = useTranslation();
  const session = useLocalSessionStore((s) => s.session);

  const [authService] = useState<AuthService>(() =>
    createAuthService({ baseUrl: API_BASE_URL }),
  );

  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [pinTarget, setPinTarget] = useState<UserRow | null>(null);
  const [isSettingPin, setIsSettingPin] = useState(false);

  // ------------------------------------------------------------------
  // Data fetching
  // ------------------------------------------------------------------

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      // DELETED is a virtual status — server uses `deleted` query param
      const isDeletedFilter = statusFilter === "DELETED";
      const result = await authService.listUsers({
        role: roleFilter || undefined,
        status: isDeletedFilter ? undefined : statusFilter || undefined,
        deleted: isDeletedFilter ? "true" : undefined,
      });
      setUsers(result.users as UserRow[]);
      setTotal(result.total);
    } catch {
      notify.error({ title: t("user_management.load_error") });
    } finally {
      setIsLoading(false);
    }
  }, [authService, roleFilter, statusFilter, t]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  const handleCreateUser = async (data: NewUserForm) => {
    try {
      await authService.createUser({
        displayName: data.displayName,
        username: data.username || undefined,
        email: data.email || undefined,
        role: data.role,
        initialPin: data.initialPin || undefined,
      });
      setShowCreateModal(false);
      notify.success({ title: t("user_management.user_created") });
      void fetchUsers();
    } catch {
      notify.error({ title: t("user_management.create_error") });
    }
  };

  const handleDisable = async (userId: string) => {
    try {
      const target = users.find((u) => u.id === userId);
      if (target?.isActive) {
        await authService.disableUser(userId);
        notify.success({ title: t("user_management.user_disabled") });
      } else {
        await authService.enableUser(userId);
        notify.success({ title: t("user_management.user_enabled") });
      }
      void fetchUsers();
    } catch {
      notify.error({ title: t("user_management.disable_error") });
    }
  };

  const handleResetPin = (userId: string) => {
    const target = users.find((u) => u.id === userId);
    if (target) setPinTarget(target);
  };

  const handleSetPinSubmit = async (newPin: string) => {
    if (!pinTarget) return;
    setIsSettingPin(true);
    try {
      await authService.resetUserPin(pinTarget.id, newPin);
      setPinTarget(null);
      notify.success({ title: t("user_management.pin_updated") });
      void fetchUsers();
    } catch {
      notify.error({ title: t("user_management.reset_pin_error") });
    } finally {
      setIsSettingPin(false);
    }
  };

  const handleEditUser = async (userId: string, data: EditUserFormData) => {
    try {
      await authService.updateUser(userId, {
        displayName: data.displayName || undefined,
        email: data.email || undefined,
        role: data.role || undefined,
      });
      setEditTarget(null);
      notify.success({ title: t("user_management.user_updated") });
      void fetchUsers();
    } catch {
      notify.error({ title: t("user_management.update_error") });
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await authService.deleteUser(userId);
      setDeleteTarget(null);
      notify.success({ title: t("user_management.user_deleted") });
      void fetchUsers();
    } catch {
      notify.error({ title: t("user_management.delete_error") });
    }
  };

  // ------------------------------------------------------------------
  // Role gate
  // ------------------------------------------------------------------

  if (!session || !hasMinRole(session, RoleType.MANAGER)) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-ink-muted text-sm">{t("user_management.no_permission")}</p>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col bg-surface p-pos-md">
      <UserTable
        users={users}
        total={total}
        isLoading={isLoading}
        currentUserId={session.userId}
        roleFilter={roleFilter}
        statusFilter={statusFilter}
        onRoleFilterChange={setRoleFilter}
        onStatusFilterChange={setStatusFilter}
        onRefresh={fetchUsers}
        onAddUser={() => setShowCreateModal(true)}
        onDisable={handleDisable}
        onResetPin={handleResetPin}
        onEdit={setEditTarget}
        onDelete={setDeleteTarget}
      />

      <CreateUserModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateUser}
      />

      {editTarget !== null && (
        <EditUserModal
          isOpen
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSubmit={handleEditUser}
        />
      )}

      {deleteTarget !== null && (
        <DeleteUserDialog
          isOpen
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDeleteUser}
        />
      )}

      <SetPinDialog
        isOpen={pinTarget !== null}
        userName={pinTarget?.displayName ?? ""}
        isSubmitting={isSettingPin}
        onClose={() => setPinTarget(null)}
        onSubmit={handleSetPinSubmit}
      />
    </div>
  );
};
