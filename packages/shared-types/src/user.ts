import { IdentificationType, RoleType } from "./enums";

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  identificationType: IdentificationType;
  identificationNumber: string;
  role: RoleType;
  isActive: boolean;
  failedLoginAttempts?: number;
  lockedUntil?: Date | null;
  passwordHash?: string;
  passwordAlgorithm?: string;
  createdAt: string;
  updatedAt: string;
}
