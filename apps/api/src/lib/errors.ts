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
export const forbidden = () =>
  new AppError(403, 'forbidden', 'Your role does not allow this action.');
export const notFound = (what = 'That record') =>
  new AppError(404, 'not_found', `${what} could not be found.`);

/** 422 with per-field messages, matching the envelope zod failures produce. */
export const invalidFields = (fields: Record<string, string>) =>
  new AppError(422, 'validation', 'Please correct the highlighted fields.', fields);
