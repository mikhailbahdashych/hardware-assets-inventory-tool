export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthorized = () => new AppError(401, 'unauthorized', 'Sign in to continue.');
export const invalidCredentials = () =>
  new AppError(401, 'invalid_credentials', 'Incorrect email or password.');
export const invalidToken = () =>
  new AppError(401, 'invalid_token', 'This link is invalid or has expired.');
/**
 * The public surface's one refusal. Missing header, malformed header, unknown
 * token and expired token all land here with the same sentence: which of them
 * it was is not the caller's business, and `resolveApiToken` already answers
 * null to all of the last three without saying why.
 */
export const invalidApiToken = () =>
  new AppError(401, 'invalid_token', 'A valid API token is required for this endpoint.');

/**
 * Names the scope the endpoint wants and nothing about the scopes the token
 * holds — the reach of a credential must not be readable by poking at doors.
 */
export const missingScope = (scope: string) =>
  new AppError(403, 'missing_scope', `This API token does not carry the "${scope}" scope.`);

export const forbidden = () =>
  new AppError(403, 'forbidden', 'Your role does not allow this action.');
export const notFound = (what = 'That record') =>
  new AppError(404, 'not_found', `${what} could not be found.`);

/** 422 with per-field messages, matching the envelope zod failures produce. */
export const invalidFields = (fields: Record<string, string>) =>
  new AppError(422, 'validation', 'Please correct the highlighted fields.', fields);
