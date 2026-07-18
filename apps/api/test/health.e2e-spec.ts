import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './utils/configure-app';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = configureApp(moduleFixture.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health reports ok with the database up', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    const body = res.body as { status: string; info: { database: { status: string } } };
    expect(body.status).toBe('ok');
    expect(body.info.database.status).toBe('up');
  });
});
