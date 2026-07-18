import { INestApplication } from '@nestjs/common';

/**
 * Everything the HTTP app needs beyond NestFactory.create — used by both the
 * real bootstrap (main.ts) and e2e tests, so the two can never drift.
 * Later phases extend this (cookies, validation pipe, serialization, swagger).
 */
export function configureApp<T>(app: INestApplication<T>): INestApplication<T> {
  app.setGlobalPrefix('api/v1');
  return app;
}
