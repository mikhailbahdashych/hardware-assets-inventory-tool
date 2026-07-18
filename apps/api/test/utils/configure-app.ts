import { INestApplication } from '@nestjs/common';

/** Mirrors main.ts bootstrap configuration — keep the two in sync. */
export function configureApp<T>(app: INestApplication<T>): INestApplication<T> {
  app.setGlobalPrefix('api/v1');
  return app;
}
