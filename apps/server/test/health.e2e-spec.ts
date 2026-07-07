import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('App (e2e) — health / smoke', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /unknown-route — returns 404 for non-existent paths', async () => {
    const res = await request(app.getHttpServer())
      .get('/does-not-exist')
      .expect(404);

    expect(res.body).toHaveProperty('message');
  });

  it('POST /auth/login — returns 401 for missing credentials (validates auth module is wired)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({})
      .expect(401);

    expect(res.body).toHaveProperty('message');
  });
});
