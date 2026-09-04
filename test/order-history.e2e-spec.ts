import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { Server } from 'node:http';
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

interface OrderBody {
  id: string;
  status: string;
  total: { amount: number; currency: string };
}

interface OrderListBody {
  data: OrderBody[];
  meta: { total: number; limit: number; offset: number };
}

// Real Postgres via Testcontainers, same setup as auth.e2e-spec.ts. Orders
// are seeded directly via Prisma in various statuses/totals/createdAt —
// bypassing cart → checkout → payment entirely, since this suite is about
// listOrders' filtering/pagination/ownership, not the checkout flow itself
// (see checkout.e2e-spec.ts for that; the full cart-to-paid-via-Stripe-
// webhook path lands with Slice 5).
describe('Order history (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication<Server>;
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

    expect(response.status).toBe(200);
    const body = response.body as OrderListBody;
    expect(body.meta.total).toBe(3);

    const clientAOrders = await prisma.order.findMany({
      where: { userId: clientAId },
    });
    expect(body.data.map((order) => order.id).sort()).toEqual(
      clientAOrders.map((order) => order.id).sort(),
    );

    const totals = body.data.map((order) => order.total.amount);
    expect(totals).toEqual([3000, 2000, 1000]);
  });

  it('filters by status', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/orders')
      .query({ status: OrderStatus.paid })
      .set('Authorization', `Bearer ${clientAToken}`);

    expect(response.status).toBe(200);
    const body = response.body as OrderListBody;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].status).toBe(OrderStatus.paid);
    expect(body.data[0].total.amount).toBe(2000);
  });

  it('filters by date range (createdFrom/createdTo)', async () => {
    const createdFrom = new Date(
      Date.now() - 6 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const response = await request(app.getHttpServer())
      .get('/v1/orders')
      .query({ createdFrom })
      .set('Authorization', `Bearer ${clientAToken}`);

    expect(response.status).toBe(200);
    const body = response.body as OrderListBody;
    const totals = body.data
      .map((order) => order.total.amount)
      .sort((a, b) => a - b);
    expect(totals).toEqual([2000, 3000]);
  });

  it('filters by price range (minTotal/maxTotal)', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/orders')
      .query({ minTotal: 1500, maxTotal: 2500 })
      .set('Authorization', `Bearer ${clientAToken}`);

    expect(response.status).toBe(200);
    const body = response.body as OrderListBody;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].total.amount).toBe(2000);
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

    const body1 = page1.body as OrderListBody;
    const body2 = page2.body as OrderListBody;
    expect(body1.data).toHaveLength(2);
    expect(body2.data).toHaveLength(1);
    expect(body1.meta.total).toBe(3);
    expect(body2.meta.total).toBe(3);

    const page1Ids = body1.data.map((order) => order.id);
    const page2Ids = body2.data.map((order) => order.id);
    expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
  });

  it("404s, not 403s, when a client requests another client's order by id", async () => {
    const clientBOrder = await prisma.order.findFirstOrThrow({
      where: { userId: clientBId },
    });

    const response = await request(app.getHttpServer())
      .get(`/v1/orders/${clientBOrder.id}`)
      .set('Authorization', `Bearer ${clientAToken}`);

    expect(response.status).toBe(404);
  });
});
