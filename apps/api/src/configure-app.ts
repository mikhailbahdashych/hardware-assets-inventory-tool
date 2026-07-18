import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';

/**
 * Everything the HTTP app needs beyond NestFactory.create — used by both the
 * real bootstrap (main.ts) and e2e tests, so the two can never drift.
 */
export function configureApp<T>(app: INestApplication<T>): INestApplication<T> {
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // Behind a reverse proxy (prod compose nginx), req.ip must be the real
  // client for throttling and audit metadata to mean anything.
  if (app.get(ConfigService).get<boolean>('trustProxy')) {
    (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);
  }
  return app;
}
