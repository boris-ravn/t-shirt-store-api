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
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(120_000);

function signUpPayload() {
  return {
    email: `checkout-e2e-${randomUUID()}@example.com`,
    password: 'Sup3rSecret!',
    firstName: 'Ada',
    lastName: 'Lovelace',
  };
}

interface AuthSessionBody {
  accessToken: string;
}

interface OrderBody {
  id: string;
  status: string;
}

// Real Postgres via Testcontainers, same setup as auth.e2e-spec.ts and
// order-history.e2e-spec.ts. Covers what a fully-mocked unit test cannot:
// the raw-SQL guarded UPDATEs actually running against Postgres, and real
// concurrent requests racing against the real transaction isolation the
// guards depend on.
describe('Checkout (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;

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
  });

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  async function createClientWithCart(quantity: number) {
    const agent = request(app.getHttpServer());
    const signUp = await agent.post('/v1/auth/sign-up').send(signUpPayload());
    const token = (signUp.body as AuthSessionBody).accessToken;

    const suffix = randomUUID();
    const category = await prisma.category.create({
      data: { name: `Checkout E2E ${suffix}`, slug: `checkout-e2e-${suffix}` },
    });
    const product = await prisma.product.create({
      data: { categoryId: category.id, name: 'Checkout Tee' },
    });
    const sku = await prisma.sku.create({
      data: {
        productId: product.id,
        skuCode: `CHK-${randomUUID()}`,
        size: 'M',
        color: 'black',
        price: 1999,
        stock: 10,
      },
    });

    await agent
      .post('/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ skuId: sku.id, quantity });

    return { token, skuId: sku.id };
  }

  it('reserves stock and creates a pending order on a normal checkout', async () => {
    const { token, skuId } = await createClientWithCart(3);

    const response = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(201);
    const body = response.body as OrderBody;
    expect(body.status).toBe('pending');

    const sku = await prisma.sku.findUniqueOrThrow({ where: { id: skuId } });
    expect(sku.stock).toBe(10);
    expect(sku.reservedStock).toBe(3);

    const cartItemCount = await prisma.cartItem.count({
      where: { sku: { id: skuId } },
    });
    expect(cartItemCount).toBe(0);
  });

  it('releases reserved stock on cancel from pending', async () => {
    const { token, skuId } = await createClientWithCart(2);

    const created = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const orderId = (created.body as OrderBody).id;

    const afterReserve = await prisma.sku.findUniqueOrThrow({
      where: { id: skuId },
    });
    expect(afterReserve.reservedStock).toBe(2);

    const cancelled = await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    expect(cancelled.status).toBe(200);

    const afterCancel = await prisma.sku.findUniqueOrThrow({
      where: { id: skuId },
    });
    expect(afterCancel.stock).toBe(10);
    expect(afterCancel.reservedStock).toBe(0);
  });

  // Regression test — see decisions.md, 2026-09-03, for the bug this covers.
  it('creates exactly one order when the same cart is checked out concurrently', async () => {
    const { token, skuId } = await createClientWithCart(1);

    const agent = request(app.getHttpServer());
    const [res1, res2] = await Promise.all([
      agent.post('/v1/orders').set('Authorization', `Bearer ${token}`).send({}),
      agent.post('/v1/orders').set('Authorization', `Bearer ${token}`).send({}),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = res1.status === 201 ? res1 : res2;
    const loser = res1.status === 201 ? res2 : res1;
    expect((loser.body as { type: string }).type).toContain('cart-empty');
    expect((winner.body as OrderBody).status).toBe('pending');

    const sku = await prisma.sku.findUniqueOrThrow({ where: { id: skuId } });
    expect(sku.reservedStock).toBe(1);

    const ordersForSku = await prisma.order.count({
      where: { items: { some: { skuId } } },
    });
    expect(ordersForSku).toBe(1);
  });
});
