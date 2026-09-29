import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Health & response format (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(() => app.close());

  it('GET /health/ready -> DB & Redis ok, wrapped envelope, request id echoed', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .set('X-Request-Id', 'test-req-1')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('test-req-1');
    expect(res.body).toEqual({
      success: true,
      data: { status: 'ok', checks: { db: 'ok', redis: 'ok' } },
      meta: null,
      message: null,
    });
  });

  it('unknown route -> error envelope with NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.request_id).toBeTruthy();
  });
});
