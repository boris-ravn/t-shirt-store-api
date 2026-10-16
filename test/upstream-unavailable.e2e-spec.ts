import request from 'supertest';
import { bootstrapE2eApp, E2eApp } from './support/e2e-app';

jest.setTimeout(120_000);

// Its own file and its own container on purpose: stopping Postgres
// mid-suite would break every other test sharing that container.
describe('Upstream unavailable (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootstrapE2eApp();
    // Stopped here, not in a test, so the assertions only see the outage.
    // Observed here: the pool's idle connections die with pg's bare
    // 'Connection terminated unexpectedly' Error, which Prisma passes
    // through unwrapped. Once those are evicted, a fresh connect fails as
    // a P1001 DatabaseNotReachable. Both are classified as a database
    // outage (isDatabaseUnavailable).
    await e2e.container.stop();
  });

  afterAll(async () => {
    // Not teardownE2eApp: the container is already stopped above.
    await e2e.app.close();
  });

  // A public route, so no sign-in (which would itself need the database).
  function getCategories() {
    return request(e2e.app.getHttpServer()).get('/v1/categories');
  }

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
