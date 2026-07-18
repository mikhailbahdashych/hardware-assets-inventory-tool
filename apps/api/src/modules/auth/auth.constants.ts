export const ACCESS_COOKIE = 'sit_access';
export const REFRESH_COOKIE = 'sit_refresh';
/** The refresh cookie is scoped to the auth controller only. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
/** Presenting a just-rotated token within this window is a benign multi-tab race. */
export const REFRESH_REUSE_GRACE_MS = 30_000;
