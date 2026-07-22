/**
 * User management page (manager/owner only).
 *
 * Thin wiring container: owns state, side-effects, and action handlers.
 * Presentational sub-components are imported from sibling files.
 *
 * Lists users with avatar, display name, role, status, last login.
 * Filter by role, status.
 * Per-user actions: edit, disable, reset PIN.
 *
 * @category Page
 */

import { type FC, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSessionStore, hasMinRole } from "../../../domain/auth/local-session.store";
import { createAuthService, type AuthService } from "../../../domain/auth/auth.service";
import { API_BASE_URL } from "@infra/config";
import { RoleType } from "@pharmacy/shared-types";
import { UserTable } from "./user-table";
import { CreateUserModal } from "./create-user-modal";
import type { UserRow, NewUserForm } from "./user-management.types";

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
  const [error, setError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);

  // Create-user modal
  const [showCreateModal, setShowCreateModal] = useState(false);

  // ------------------------------------------------------------------
  // Data fetching
  // ------------------------------------------------------------------

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await authService.listUsers({
        role: roleFilter || undefined,
        status: statusFilter || undefined,
      });
      setUsers(result.users as UserRow[]);
      setTotal(result.total);
    } catch {
      setError(t("user_management.load_error"));
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
      setActionResult(t("user_management.user_created"));
      void fetchUsers();
    } catch {
      setError(t("user_management.create_error"));
    }
  };

  const handleDisable = async (userId: string) => {
    try {
      const target = users.find((u) => u.id === userId);
      if (target?.isActive) {
        await authService.disableUser(userId);
        setActionResult(t("user_management.user_disabled"));
      } else {
        await authService.enableUser(userId);
        setActionResult(t("user_management.user_enabled"));
      }
      void fetchUsers();
    } catch {
      setError(t("user_management.disable_error"));
    }
  };

  const handleResetPin = async (userId: string) => {
    try {
      await authService.resetUserPin(userId);
      setActionResult(t("user_management.pin_reset"));
      void fetchUsers();
    } catch {
      setError(t("user_management.reset_pin_error"));
    }
  };

  // ------------------------------------------------------------------
  // Role gate
  // ------------------------------------------------------------------

  if (!session || !hasMinRole(session, RoleType.MANAGER)) {
    return (
      <div className="flex h-full items-center justify-center">
        <p style={{ color: "var(--color-ink-muted)" }}>
          {t("user_management.no_permission")}
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div
      className="flex h-full flex-col p-pos-md"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      <UserTable
        users={users}
        total={total}
        isLoading={isLoading}
        error={error}
        actionResult={actionResult}
        currentUserId={session.userId}
        roleFilter={roleFilter}
        statusFilter={statusFilter}
        onRoleFilterChange={setRoleFilter}
        onStatusFilterChange={setStatusFilter}
        onRefresh={fetchUsers}
        onAddUser={() => setShowCreateModal(true)}
        onDisable={handleDisable}
        onResetPin={handleResetPin}
        onClearActionResult={() => setActionResult(null)}
        onClearError={() => setError(null)}
      />

      <CreateUserModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateUser}
      />
    </div>
  );
};
