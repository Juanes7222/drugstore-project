/**
 * Local user seed data for the login page avatar grid.
 *
 * In production, this list is fetched from the server. The placeholder
 * data provides a realistic development experience without requiring
 * network connectivity.
 */

import { RoleType } from '@pharmacy/shared-types';

export interface LocalUserInfo {
  id: string;
  displayName: string;
  role: RoleType;
  avatarUrl: string | null;
  avatarColor: string | null;
  username: string;
}

/**
 * Matches the server seed data in `apps/server/seed/seed/users.ts`.
 *
 * - Username / password pairs match the seeded development users exactly,
 *   so the login flow works out of the box against a freshly seeded server.
 * - In production this list is replaced by server-fetched users; this
 *   placeholder data exists solely for the dev avatar grid UX.
 */
export const PLACEHOLDER_USERS: LocalUserInfo[] = [
  {
    id: 'user_admin',
    displayName: 'Administrador del Sistema',
    role: RoleType.ADMIN,
    avatarUrl: null,
    avatarColor: '#4F46E5',
    username: 'admin',
  },
  {
    id: 'user_cashier1',
    displayName: 'María Rodríguez',
    role: RoleType.CASHIER,
    avatarUrl: null,
    avatarColor: '#D97706',
    username: 'cashier1',
  },
  {
    id: 'user_cashier2',
    displayName: 'Carlos Méndez',
    role: RoleType.CASHIER,
    avatarUrl: null,
    avatarColor: '#DC2626',
    username: 'cashier2',
  },
  {
    id: 'user_inventory',
    displayName: 'Luisa García',
    role: RoleType.INVENTORY_ASSISTANT,
    avatarUrl: null,
    avatarColor: '#059669',
    username: 'inventory',
  },
  {
    id: 'user_accountant',
    displayName: 'Pedro Contreras',
    role: RoleType.ACCOUNTANT,
    avatarUrl: null,
    avatarColor: '#8B5CF6',
    username: 'accountant',
  },
];
