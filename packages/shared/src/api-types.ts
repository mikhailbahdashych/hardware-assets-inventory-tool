import { UserRole } from './enums';

/** Standard paginated list envelope returned by every list endpoint. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** The user object every auth endpoint returns (secrets are never serialized). */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  mfaEnforced: boolean;
}

export interface SetupRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
