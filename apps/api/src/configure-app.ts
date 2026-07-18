import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import cookieParser from 'cookie-parser';

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
  return app;
}
