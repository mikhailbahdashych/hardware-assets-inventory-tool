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

/** Second-factor challenge issued when a password login hits an MFA-enabled account. */
export interface MfaRequiredResponse {
  mfaRequired: true;
  /** Short-lived opaque-to-the-client ticket to present at /auth/login/mfa. */
  ticket: string;
}

export type LoginResponse = SessionUser | MfaRequiredResponse;

export function isMfaRequired(response: LoginResponse): response is MfaRequiredResponse {
  return 'mfaRequired' in response && response.mfaRequired === true;
}

export interface MfaLoginRequest {
  ticket: string;
  /** 6-digit TOTP code or a recovery code (xxxxx-xxxxx). */
  code: string;
}

export interface MfaSetupResponse {
  otpauthUri: string;
}

export interface MfaVerifyRequest {
  code: string;
}

export interface MfaVerifyResponse {
  /** Shown exactly once — the server stores only hashes. */
  recoveryCodes: string[];
}

/** 403 message the API emits when MFA enrollment blocks a route — the web app routes on it. */
export const MFA_ENROLLMENT_REQUIRED_MESSAGE = 'mfa enrollment required';

export interface CreateUserRequest {
  email: string;
  displayName: string;
  role: UserRole;
}

export interface UpdateUserRequest {
  displayName?: string;
  role?: UserRole;
  isActive?: boolean;
  mfaEnforced?: boolean;
}

/** tempPassword is returned exactly once — the server stores only the hash. */
export interface CreateUserResponse {
  user: SessionUser;
  tempPassword: string;
}

export interface ResetPasswordResponse {
  tempPassword: string;
}
