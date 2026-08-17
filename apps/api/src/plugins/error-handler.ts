import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import type { ApiErrorEnvelope } from '@inventory/shared';
import { AppError } from '@/lib/errors.js';
import type { HttpErrorLike, ZodValidationParams } from '@/types/errors.js';

/** The one envelope shape, built in one place so no route can invent another. */
const envelope = (
  code: string,
  message: string,
  fields?: Record<string, string>,
): ApiErrorEnvelope => ({ error: { code, message, fields } });

/**
 * Fastify types the thrown value as `unknown`. This narrows it for real rather
 * than casting: an Error always has a `message`, and fastify's own errors add
 * a `statusCode`. Anything else is not something we can describe, and falls
 * through to the 500 branch.
 */
function asHttpError(error: unknown): HttpErrorLike | null {
  if (!(error instanceof Error)) return null;
  const statusCode =
    'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : undefined;
  return { statusCode, message: error.message };
}

// One error envelope everywhere: { error: { code, message, fields? } }.
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const fields: Record<string, string> = {};
      for (const validation of error.validation) {
        const { issue } = validation.params as ZodValidationParams;
        if (issue?.path && issue.message) fields[issue.path.join('.')] = issue.message;
      }
      return reply.status(422).send(envelope('validation', 'Request validation failed.', fields));
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(envelope(error.code, error.message, error.fields));
    }

    const httpError = asHttpError(error);
    if (httpError?.statusCode === 429) {
      return reply
        .status(429)
        .send(envelope('rate_limited', 'Too many attempts — try again later.'));
    }

    if (httpError?.statusCode && httpError.statusCode < 500) {
      return reply.status(httpError.statusCode).send(envelope('bad_request', httpError.message));
    }

    app.log.error(error);
    return reply.status(500).send(envelope('internal', 'Something went wrong on the server.'));
  });
}
