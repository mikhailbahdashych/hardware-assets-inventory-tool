export enum UserRole {
  ADMIN = 'admin',
  MANAGER = 'manager',
  VIEWER = 'viewer',
}

export enum AssetStatus {
  AVAILABLE = 'available',
  ASSIGNED = 'assigned',
  IN_REPAIR = 'in_repair',
  RETIRED = 'retired',
  LOST = 'lost',
}

export enum AuditAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  CHECKOUT = 'checkout',
  CHECKIN = 'checkin',
  IMPORT = 'import',
  EXPORT = 'export',
  LOGIN = 'login',
  LOGIN_FAILED = 'login_failed',
  LOGIN_MFA_FAILED = 'login_mfa_failed',
  LOGOUT = 'logout',
  SETUP = 'setup',
  PASSWORD_CHANGE = 'password_change',
  MFA_SETUP = 'mfa_setup',
  MFA_RESET = 'mfa_reset',
  MFA_DISABLED = 'mfa_disabled',
}
