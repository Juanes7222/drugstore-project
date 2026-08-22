import { RoleType } from '@pharmacy/shared-types';
import { useAuthStore } from './use-auth';

/**
 * Role-based helpers. Subscriptions is the only SAAS_ADMIN-only surface;
 * everything else is available to any authenticated admin/owner/manager.
 */
export function usePermissions() {
  const user = useAuthStore((state) => state.user);
  const role = user?.role ?? null;

  return {
    role,
    isSaaSAdmin: role === RoleType.SAAS_ADMIN,
    canViewSubscriptions: role === RoleType.SAAS_ADMIN,
    canManageUsers: role !== null,
  };
}