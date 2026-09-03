import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OrderStatus } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(120_000);

function signUpPayload(overrides: Partial<Record<string, string>> = {}) {
  return {
    email: `order-history-e2e-${randomUUID()}@example.com`,
    password: 'Sup3rSecret!',
    firstName: 'Ada',
    lastName: 'Lovelace',
    ...overrides,
  };
}

interface AuthSessionBody {
  accessToken: string;
  user: { id: string };
}

// Real Postgres via Testcontainers, same setup as auth.e2e-spec.ts. Orders
// are seeded directly via Prisma in various statuses/totals/createdAt —
// bypassing cart → checkout → payment entirely, since this suite is about
// listOrders' filtering/pagination/ownership, not the checkout flow itself
// (covered by OrdersService's unit tests and manual verification instead;
// the full cart-to-paid-via-Stripe-webhook path lands with Slice 5).
describe('Order history (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;

  let clientAToken: string;
  let clientAId: string;
  let clientBId: string;
  let skuId: string;
  let productId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('tshirt_store_test')
      .withUsername('tshirt_store_test')
      .withPassword('tshirt_store_test')
      .start();

    const databaseUrl = container.getConnectionUri();

    execSync('npx prisma migrate deploy', {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DOTENV_CONFIG_QUIET: 'true',
      },
      stdio: 'inherit',
    });

    const testPrismaService = new PrismaService({
      getOrThrow: () => databaseUrl,
    } as unknown as ConfigService);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(testPrismaService)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleRef.get(PrismaService);

    // Fixture setup: two clients (A's orders are the ones under test, B's
    // order proves A can't see it), one category/product/sku created
    // directly since no manager-signup flow is needed for this suite's
    // purpose.
    const agent = request(app.getHttpServer());
    const clientA = signUpPayload();
    const signUpA = await agent.post('/v1/auth/sign-up').send(clientA);
    const bodyA = signUpA.body as AuthSessionBody;
    clientAToken = bodyA.accessToken;
    clientAId = bodyA.user.id;

    const clientB = signUpPayload();
    const signUpB = await agent.post('/v1/auth/sign-up').send(clientB);
    clientBId = (signUpB.body as AuthSessionBody).user.id;

    const category = await prisma.category.create({
      data: { name: 'E2E Category', slug: `e2e-category-${randomUUID()}` },
    });
    const product = await prisma.product.create({
      data: { categoryId: category.id, name: 'E2E Product' },
    });
    productId = product.id;
    const sku = await prisma.sku.create({
      data: {
        productId: product.id,
        skuCode: `E2E-${randomUUID()}`,
        size: 'M',
        color: 'black',
        price: 1999,
        stock: 100,
      },
    });
    skuId = sku.id;

    // One order per (status, total, createdAt) combination the filter
    // tests need — created directly via Prisma, not the checkout endpoint.
    await seedOrder({
      userId: clientAId,
      status: OrderStatus.pending,
      total: 1000,
      daysAgo: 10,
    });
    await seedOrder({
      userId: clientAId,
      status: OrderStatus.paid,
      total: 2000,
      daysAgo: 5,
    });
    await seedOrder({
      userId: clientAId,
      status: OrderStatus.shipped,
      total: 3000,
      daysAgo: 1,
    });
    await seedOrder({
      userId: clientBId,
      status: OrderStatus.pending,
      total: 5000,
      daysAgo: 1,
    });

    async function seedOrder(opts: {
      userId: string;
      status: OrderStatus;
      total: number;
      daysAgo: number;
    }) {
      const createdAt = new Date(
        Date.now() - opts.daysAgo * 24 * 60 * 60 * 1000,
      );
      await prisma.order.create({
        data: {
          userId: opts.userId,
          status: opts.status,
          subtotal: opts.total,
          discountAmount: 0,
          total: opts.total,
          createdAt,
          items: {
            create: {
              skuId,
              productId,
              quantity: 1,
              unitPrice: opts.total,
              productName: 'E2E Product',
              size: 'M',
              color: 'black',
            },
          },
          statusHistory: {
            create: { status: opts.status, changedBy: opts.userId },
          },
        },
      });
    }
  });

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  it("lists only the caller's own orders, newest first by default", async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/orders')
      .set('Authorization', `Bearer ${clientAToken}`);

    // TODO(testing agent): assert response.status === 200, body.meta.total
    // === 3 (not 4 — clientB's order excluded), and the three returned ids
    // all belong to clientA, ordered by createdAt descending.
    void response;
  });

  it('filters by status', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/orders')
      .query({ status: OrderStatus.paid })
      .set('Authorization', `Bearer ${clientAToken}`);

    // TODO(testing agent): assert only the `paid` order (total 2000) comes
    // back.
    void response;
  });

  it('filters by date range (createdFrom/createdTo)', async () => {
    const createdFrom = new Date(
      Date.now() - 6 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const response = await request(app.getHttpServer())
      .get('/v1/orders')
      .query({ createdFrom })
      .set('Authorization', `Bearer ${clientAToken}`);

    // TODO(testing agent): assert only the two orders created within the
    // last 6 days (paid, shipped) come back — the 10-days-ago pending order
    // is excluded.
    void response;
  });

  it('filters by price range (minTotal/maxTotal)', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/orders')
      .query({ minTotal: 1500, maxTotal: 2500 })
      .set('Authorization', `Bearer ${clientAToken}`);

    // TODO(testing agent): assert only the 2000-total order comes back.
    void response;
  });

  it('paginates with limit/offset', async () => {
    const page1 = await request(app.getHttpServer())
      .get('/v1/orders')
      .query({ limit: 2, offset: 0 })
      .set('Authorization', `Bearer ${clientAToken}`);
    const page2 = await request(app.getHttpServer())
      .get('/v1/orders')
      .query({ limit: 2, offset: 2 })
      .set('Authorization', `Bearer ${clientAToken}`);

    // TODO(testing agent): assert page1.body.data has 2 items, page2 has 1,
    // meta.total is 3 on both, and no order id appears on both pages.
    void page1;
    void page2;
  });

  it("404s, not 403s, when a client requests another client's order by id", async () => {
    const clientBOrder = await prisma.order.findFirstOrThrow({
      where: { userId: clientBId },
    });

    const response = await request(app.getHttpServer())
      .get(`/v1/orders/${clientBOrder.id}`)
      .set('Authorization', `Bearer ${clientAToken}`);

    // TODO(testing agent): assert response.status === 404, matching the
    // ownership-hiding rule (decisions.md / api CONVENTIONS.md).
    void response;
  });
});
