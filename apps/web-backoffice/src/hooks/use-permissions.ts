import { RoleType } from "@pharmacy/shared-types";
import { useAuthStore } from "./use-auth";

/**
 * Role-based helpers for the tenant backoffice. The platform-owner surface
 * (/admin) additionally requires the server-backed isPlatformAdmin flag;
 * role alone is not sufficient to reach it.
 */
export function usePermissions() {
  const user = useAuthStore((state) => state.user);
  const role = user?.role ?? null;

  return {
    role,
    isSaaSAdmin: role === RoleType.SAAS_ADMIN,
    isPlatformAdmin:
      role === RoleType.SAAS_ADMIN && user?.isPlatformAdmin === true,
    canManageUsers: role !== null,
  };
}
