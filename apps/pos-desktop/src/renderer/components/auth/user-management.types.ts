/**
 * Types for the user management page.
 *
 * @category Types
 */

export interface UserRow {
  id: string;
  displayName: string;
  fullName?: string;
  username: string;
  email?: string | null;
  role: string;
  status: string;
  isActive: boolean;
  lastLoginAt?: string | null;
  avatarUrl?: string | null;
  avatarColor?: string | null;
}

export interface NewUserForm {
  displayName: string;
  username: string;
  email: string;
  role: "CASHIER" | "MANAGER";
  initialPin: string;
}
