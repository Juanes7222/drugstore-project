/**
 * User table — filterable list with action buttons.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "./avatar.component";
import { statusClass, formatLastLogin } from "./user-management.helpers";
import type { UserRow } from "./user-management.types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface UserTableProps {
  users: UserRow[];
  total: number;
  isLoading: boolean;
  error: string | null;
  actionResult: string | null;
  currentUserId?: string;
  roleFilter: string;
  statusFilter: string;
  onRoleFilterChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onRefresh: () => void;
  onAddUser: () => void;
  onDisable: (userId: string) => void;
  onResetPin: (userId: string) => void;
  onClearActionResult: () => void;
  onClearError: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const UserTable: FC<UserTableProps> = ({
  users,
  total,
  isLoading,
  error,
  actionResult,
  currentUserId,
  roleFilter,
  statusFilter,
  onRoleFilterChange,
  onStatusFilterChange,
  onRefresh,
  onAddUser,
  onDisable,
  onResetPin,
  onClearActionResult,
  onClearError,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h1
          className="text-heading font-bold"
          style={{ color: "var(--color-ink)" }}
        >
          {t("user_management.title")}
        </h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="pos-button pos-button--ghost"
          >
            {t("common.refresh")}
          </button>
          <button
            type="button"
            onClick={onAddUser}
            className="pos-button pos-button--primary"
          >
            + {t("user_management.add_user")}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-2">
        <select
          value={roleFilter}
          onChange={(e) => onRoleFilterChange(e.target.value)}
          className="pos-input"
          style={{ maxWidth: 150 }}
          aria-label={t("user_management.filter_role")}
        >
          <option value="">{t("common.all_roles")}</option>
          <option value="CASHIER">{t("roles.cashier")}</option>
          <option value="MANAGER">{t("roles.manager")}</option>
          <option value="OWNER">{t("roles.owner")}</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className="pos-input"
          style={{ maxWidth: 150 }}
          aria-label={t("user_management.filter_status")}
        >
          <option value="">{t("common.all_status")}</option>
          <option value="ACTIVE">{t("user_management.status_active")}</option>
          <option value="DISABLED">{t("user_management.status_disabled")}</option>
          <option value="LOCKED">{t("user_management.status_locked")}</option>
        </select>
      </div>

      {/* Action result toast */}
      {actionResult && (
        <div
          className="mb-2 flex items-center justify-between rounded p-2 text-sm"
          style={{
            backgroundColor: "var(--color-success-container)",
            color: "var(--color-success)",
          }}
        >
          <span>{actionResult}</span>
          <button
            type="button"
            onClick={onClearActionResult}
            className="ml-2 cursor-pointer border-none bg-transparent"
            style={{ color: "inherit" }}
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div
          className="mb-2 flex items-center justify-between rounded p-2 text-sm"
          style={{
            backgroundColor: "var(--color-error-container)",
            color: "var(--color-error)",
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={onClearError}
            className="ml-2 cursor-pointer border-none bg-transparent"
            style={{ color: "inherit" }}
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>
      )}

      {/* User list */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <p style={{ color: "var(--color-ink-muted)" }}>
            {t("common.loading")}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table
            className="w-full"
            style={{ borderCollapse: "collapse", fontSize: 14 }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--color-border)",
                  color: "var(--color-ink-muted)",
                  textAlign: "left",
                }}
              >
                <th className="p-2">{t("user_management.user")}</th>
                <th className="p-2">{t("user_management.role")}</th>
                <th className="p-2">{t("user_management.status")}</th>
                <th className="p-2">{t("user_management.last_login")}</th>
                <th className="p-2">{t("user_management.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="hover-row"
                  style={{
                    borderBottom: "1px solid var(--color-border)",
                    transition: "background-color 0.1s",
                  }}
                >
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <Avatar
                        displayName={user.displayName}
                        avatarUrl={user.avatarUrl}
                        avatarColor={user.avatarColor}
                        userId={user.id}
                        size={32}
                      />
                      <div>
                        <p
                          className="font-medium"
                          style={{ color: "var(--color-ink)" }}
                        >
                          {user.displayName || user.fullName}
                        </p>
                        <p
                          className="text-xs"
                          style={{ color: "var(--color-ink-muted)" }}
                        >
                          {user.username}
                          {user.email && ` · ${user.email}`}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="p-2">
                    <span
                      className="text-sm"
                      style={{ color: "var(--color-ink)" }}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="p-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-sm ${statusClass(user.status)}`}
                    >
                      {user.status === "ACTIVE"
                        ? t("user_management.status_active")
                        : user.status === "DISABLED"
                          ? t("user_management.status_disabled")
                          : user.status === "LOCKED"
                            ? t("user_management.status_locked")
                            : user.status}
                    </span>
                  </td>
                  <td className="p-2">
                    <span
                      className="text-sm"
                      style={{ color: "var(--color-ink-muted)" }}
                    >
                      {user.lastLoginAt
                        ? formatLastLogin(user.lastLoginAt)
                        : t("user_management.never_logged_in")}
                    </span>
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      {currentUserId !== user.id && (
                        <>
                          <button
                            type="button"
                            onClick={() => onDisable(user.id)}
                            className="pos-button pos-button--ghost px-2 py-1 text-xs"
                            title={
                              user.isActive
                                ? t("user_management.disable")
                                : t("user_management.enable")
                            }
                          >
                            {user.isActive
                              ? t("user_management.disable")
                              : t("user_management.enable")}
                          </button>
                          <button
                            type="button"
                            onClick={() => onResetPin(user.id)}
                            className="pos-button pos-button--ghost px-2 py-1 text-xs"
                            title={t("user_management.reset_pin")}
                          >
                            {t("user_management.reset_pin")}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <div className="flex h-32 items-center justify-center">
              <p style={{ color: "var(--color-ink-muted)" }}>
                {t("user_management.no_users")}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Total count */}
      <div
        className="mt-2 text-sm"
        style={{ color: "var(--color-ink-muted)" }}
      >
        {total === 1
          ? t("user_management.user_count", { count: total })
          : t("user_management.user_count_plural", { count: total })}
      </div>
    </>
  );
};
