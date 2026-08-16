import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from '@/lib/errors.js';

// One error envelope everywhere: { error: { code, message, fields? } }.
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const fields: Record<string, string> = {};
      for (const validation of error.validation) {
        const issue = (
          validation.params as { issue?: { path?: (string | number)[]; message?: string } }
        ).issue;
        if (issue?.path && issue.message) fields[issue.path.join('.')] = issue.message;
      }
      return reply
        .status(422)
        .send({ error: { code: 'validation', message: 'Request validation failed.', fields } });
    }

    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: error.message, fields: error.fields } });
    }

    const fastifyError = error as { statusCode?: number; message?: string };
    if (fastifyError.statusCode === 429) {
      return reply
        .status(429)
        .send({ error: { code: 'rate_limited', message: 'Too many attempts — try again later.' } });
    }

    if (fastifyError.statusCode && fastifyError.statusCode < 500) {
      return reply
        .status(fastifyError.statusCode)
        .send({ error: { code: 'bad_request', message: fastifyError.message ?? 'Bad request.' } });
    }

    app.log.error(error);
    return reply
      .status(500)
      .send({ error: { code: 'internal', message: 'Something went wrong on the server.' } });
  });
}
