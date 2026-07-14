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

export const PLACEHOLDER_USERS: LocalUserInfo[] = [
  {
    id: 'owner-1',
    displayName: 'Juan Pérez',
    role: RoleType.OWNER,
    avatarUrl: null,
    avatarColor: '#4F46E5',
    username: 'juan.perez',
  },
  {
    id: 'manager-1',
    displayName: 'María García',
    role: RoleType.MANAGER,
    avatarUrl: null,
    avatarColor: '#059669',
    username: 'maria.garcia',
  },
  {
    id: 'cashier-1',
    displayName: 'Carlos López',
    role: RoleType.CASHIER,
    avatarUrl: null,
    avatarColor: '#D97706',
    username: 'carlos.lopez',
  },
  {
    id: 'cashier-2',
    displayName: 'Ana Martínez',
    role: RoleType.CASHIER,
    avatarUrl: null,
    avatarColor: '#DC2626',
    username: 'ana.martinez',
  },
];
