/**
 * One zod failure as fastify-type-provider-zod hangs it off a validation
 * entry. Every field is optional because this describes somebody else's
 * payload — the error handler checks before it reads.
 */
export interface ZodValidationIssue {
  path?: (string | number)[];
  message?: string;
}

export interface ZodValidationParams {
  issue?: ZodValidationIssue;
}

/**
 * A thrown value narrowed to what the error envelope can use. `message` is
 * required because every Error has one; `statusCode` is optional because only
 * fastify's own errors carry it.
 */
export interface HttpErrorLike {
  statusCode?: number;
  message: string;
}
