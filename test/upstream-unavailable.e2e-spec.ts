import { Logger } from '@nestjs/common';
import request from 'supertest';
import { bootstrapE2eApp, E2eApp } from './support/e2e-app';

jest.setTimeout(120_000);

describe('Upstream unavailable (e2e)', () => {
  let e2e: E2eApp;
  let loggerError: jest.SpyInstance;
  let firstOutageResponse: request.Response;
  let firstOutageLog: unknown[];

  beforeAll(async () => {
    e2e = await bootstrapE2eApp();
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    // Keeps a pooled connection open, so the outage hits pg's bare Error
    // rather than the P1001 of a fresh connect.
    await getCategories().expect(200);

    await e2e.container.stop();

    firstOutageResponse = await getCategories();
    firstOutageLog = (loggerError.mock.calls as unknown[][])[0] ?? [];
  });

  afterAll(async () => {
    loggerError.mockRestore();
    await e2e.app.close();
  });

  function getCategories() {
    return request(e2e.app.getHttpServer()).get('/v1/categories');
  }

  it("answers 503 when a pooled connection dies with pg's bare Error", () => {
    expect(firstOutageResponse.status).toBe(503);
    expect(firstOutageLog[0]).toBe(
      "Upstream dependency 'database' unavailable on GET /v1/categories",
    );
    expect(firstOutageLog[1]).toEqual(
      expect.stringContaining('Error: Connection terminated unexpectedly'),
    );
  });

  it('answers 503 problem+json upstream-unavailable on a public route', async () => {
    const res = await getCategories();

    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: 'https://api.tshirt-store.example/problems/upstream-unavailable',
      title: 'Service temporarily unavailable',
      status: 503,
      instance: '/v1/categories',
    });
  });

  it('sends Retry-After: 30 and retryAfterSeconds: 30', async () => {
    const res = await getCategories();

    expect(res.headers['retry-after']).toBe('30');
    expect(res.body).toHaveProperty('retryAfterSeconds', 30);
  });

  it('does not mention the database in the response body', async () => {
    const res = await getCategories();

    expect(res.text).not.toMatch(
      /database|postgres|prisma|5432|ECONNREFUSED|DatabaseNotReachable|ConnectionClosed/i,
    );
  });
});
