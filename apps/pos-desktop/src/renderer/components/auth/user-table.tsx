/**
 * User table — filterable, scan-friendly list of pharmacy users.
 *
 * Uses i18n for all role/status labels. Each role gets a distinct badge color
 * so the cashier/manager/owner split is instantly visible at a glance.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { Avatar } from "./avatar.component";
import {
  statusClass,
  translateRole,
  roleBadgeClass,
  formatLastLogin,
  isDeletedUser,
} from "./user-management.helpers";
import type { UserRow } from "./user-management.types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface UserTableProps {
  users: UserRow[];
  total: number;
  isLoading: boolean;
  currentUserId?: string;
  roleFilter: string;
  statusFilter: string;
  onRoleFilterChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onRefresh: () => void;
  onAddUser: () => void;
  onDisable: (userId: string) => void;
  onResetPin: (userId: string) => void;
  onEdit: (user: UserRow) => void;
  onDelete: (user: UserRow) => void;
}

// ---------------------------------------------------------------------------
// Role filter options — every known role
// ---------------------------------------------------------------------------

const ROLE_OPTIONS = [
  { value: "CASHIER", key: "roles.cashier" },
  { value: "MANAGER", key: "roles.manager" },
  { value: "OWNER", key: "roles.owner" },
  { value: "ACCOUNTANT", key: "roles.accountant" },
  { value: "INVENTORY_ASSISTANT", key: "roles.inventory_assistant" },
  { value: "SAAS_ADMIN", key: "roles.saas_admin" },
] as const;

const STATUS_OPTIONS = [
  { value: "ACTIVE", key: "user_management.status_active" },
  { value: "DISABLED", key: "user_management.status_disabled" },
  { value: "LOCKED", key: "user_management.status_locked" },
  { value: "DELETED", key: "user_management.status_deleted" },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const UserTable: FC<UserTableProps> = ({
  users,
  total,
  isLoading,
  currentUserId,
  roleFilter,
  statusFilter,
  onRoleFilterChange,
  onStatusFilterChange,
  onRefresh,
  onAddUser,
  onDisable,
  onResetPin,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation();

  // ------------------------------------------------------------------
  // Loading state
  // ------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <Header
          title={t("user_management.title")}
          onRefresh={onRefresh}
          onAddUser={onAddUser}
          t={t}
        />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-ink-muted text-sm">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Main render
  // ------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <Header
        title={t("user_management.title")}
        onRefresh={onRefresh}
        onAddUser={onAddUser}
        t={t}
      />

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative">
          <select
            value={roleFilter}
            onChange={(e) => onRoleFilterChange(e.target.value)}
            className="pos-input w-auto min-w-[160px] appearance-none pr-8"
            aria-label={t("user_management.filter_role")}
          >
            <option value="">{t("common.all_roles")}</option>
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.key)}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="pos-input w-auto min-w-[140px] appearance-none pr-8"
            aria-label={t("user_management.filter_status")}
          >
            <option value="">{t("common.all_status")}</option>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.key)}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* User list */}
      <div className="pos-panel flex-1 overflow-auto">
        {users.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex h-40 items-center justify-center"
          >
            <p className="text-ink-muted text-sm">{t("user_management.no_users")}</p>
          </motion.div>
        ) : (
          <table className="w-full border-collapse font-ui text-body-sm">
            <thead>
              <tr className="border-b border-border">
                <Th>{t("user_management.user")}</Th>
                <Th>{t("user_management.role")}</Th>
                <Th>{t("user_management.status")}</Th>
                <Th>{t("user_management.last_login")}</Th>
                <Th>{t("user_management.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((user, index) => {
                  const deleted = isDeletedUser(user.deletedAt);
                return (
                  <motion.tr
                    key={user.id}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      opacity: { duration: 0.15 },
                      y: { duration: 0.2 },
                      delay: index * 0.025,
                    }}
                      className={`border-b border-border/60 transition-colors duration-75 hover:bg-surface/50 ${deleted ? "opacity-50" : ""}`}
                    >
                      {/* User */}
                      <Td>
                        <div className="flex items-center gap-3">
                          <Avatar
                            displayName={user.displayName}
                            avatarUrl={user.avatarUrl}
                            avatarColor={user.avatarColor}
                            userId={user.id}
                            size={32}
                          />
                          <div className="min-w-0">
                            <p className={`truncate font-medium ${deleted ? "text-ink-muted line-through" : "text-ink"}`}>
                              {user.displayName || user.fullName}
                            </p>
                            <p className="truncate text-caption text-ink-muted">
                              {user.username}
                              {user.email && ` · ${user.email}`}
                            </p>
                          </div>
                        </div>
                      </Td>

                      {/* Role */}
                      <Td>
                        <span
                          className={`inline-block rounded-sm px-2 py-0.5 text-caption font-semibold uppercase tracking-wider ${deleted ? "bg-ink/8 text-ink-muted line-through" : roleBadgeClass(user.role)}`}
                        >
                          {translateRole(user.role, t)}
                        </span>
                      </Td>

                      {/* Status */}
                      <Td>
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-caption font-semibold ${deleted ? statusClass("DELETED") : statusClass(user.status)}`}
                        >
                          {deleted
                            ? t("user_management.status_deleted")
                            : user.status === "ACTIVE"
                              ? t("user_management.status_active")
                              : user.status === "DISABLED"
                                ? t("user_management.status_disabled")
                                : user.status === "LOCKED"
                                  ? t("user_management.status_locked")
                                  : user.status}
                        </span>
                      </Td>

                      {/* Last login */}
                      <Td>
                        <span className="text-ink-muted text-caption tabular-nums">
                          {user.lastLoginAt
                            ? formatLastLogin(user.lastLoginAt)
                            : t("user_management.never_logged_in")}
                        </span>
                      </Td>

                      {/* Actions */}
                      <Td>
                        {currentUserId !== user.id && (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={deleted}
                              onClick={() => onEdit(user)}
                              className={`rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors ${
                                deleted
                                  ? "cursor-not-allowed border-border/30 bg-panel text-ink-muted/50"
                                  : "border-border bg-panel text-ink hover:bg-surface active:bg-surface-variant"
                              }`}
                              title={t("common.edit")}
                            >
                              {t("common.edit")}
                            </button>
                            <button
                              type="button"
                              disabled={deleted}
                              onClick={() => onDisable(user.id)}
                              className={`rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors ${
                                deleted
                                  ? "cursor-not-allowed border-border/30 bg-panel text-ink-muted/50"
                                  : "border-border bg-panel text-ink hover:bg-surface active:bg-surface-variant"
                              }`}
                            >
                              {user.isActive
                                ? t("user_management.disable")
                                : t("user_management.enable")}
                            </button>
                            <button
                              type="button"
                              disabled={deleted}
                              onClick={() => onResetPin(user.id)}
                              className={`rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors ${
                                deleted
                                  ? "cursor-not-allowed border-border/30 bg-panel text-ink-muted/50"
                                  : "border-border bg-panel text-ink hover:bg-surface active:bg-surface-variant"
                              }`}
                            >
                              {t("user_management.reset_pin")}
                            </button>
                            <button
                              type="button"
                              disabled={deleted}
                              onClick={() => !deleted && onDelete(user)}
                              className={`rounded-sm border px-2.5 py-1 text-caption font-medium transition-colors ${
                                deleted
                                  ? "cursor-not-allowed border-border/30 bg-panel text-ink-muted/50"
                                  : "border border-error/30 bg-panel text-error hover:bg-error-container"
                              }`}
                              title={
                                deleted
                                  ? t("user_management.user_already_deleted")
                                  : t("user_management.delete_user")
                              }
                            >
                              {t("common.remove")}
                            </button>
                          </div>
                        )}
                      </Td>
                    </motion.tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </div>

      {/* Count */}
      <div className="mt-2 text-caption text-ink-muted tabular-nums">
        {total === 1
          ? t("user_management.user_count", { count: total })
          : t("user_management.user_count_plural", { count: total })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-components (colocated — trivial, used once, no extraction benefit)
// ---------------------------------------------------------------------------

/** Table header cell */
const Th: FC<{ children: string }> = ({ children }) => (
  <th className="sticky top-0 bg-surface/90 px-4 py-2.5 text-left text-caption font-semibold uppercase tracking-wider text-ink-muted backdrop-blur-sm">
    {children}
  </th>
);

/** Table data cell */
const Td: FC<{ children: React.ReactNode }> = ({ children }) => (
  <td className="px-4 py-3">{children}</td>
);

// ---------------------------------------------------------------------------
// Header sub-component
// ---------------------------------------------------------------------------

interface HeaderProps {
  title: string;
  onRefresh: () => void;
  onAddUser: () => void;
  t: (key: string) => string;
}

const Header: FC<HeaderProps> = ({ title, onRefresh, onAddUser, t }) => (
  <div className="mb-4 flex items-center justify-between">
    <h1 className="pos-page-title">{title}</h1>
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onRefresh}
        className="pos-button pos-button-secondary text-sm"
      >
        {t("common.refresh")}
      </button>
      <button
        type="button"
        onClick={onAddUser}
        className="pos-button pos-button-primary text-sm"
      >
        + {t("user_management.add_user")}
      </button>
    </div>
  </div>
);
