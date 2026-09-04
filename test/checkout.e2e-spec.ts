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
import Stripe from 'stripe';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PaymentMethod, PaymentStatus } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/prisma/prisma.service';
import { STRIPE_CLIENT } from '../src/stripe/stripe.constants';

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
// Set only when a developer has added a real Stripe test-mode key to .env
// (see test/env-setup.ts) — gates the tests that call the actual Stripe API.
const hasRealStripeKey =
  process.env.STRIPE_SECRET_KEY !== 'sk_test_e2e_placeholder';

function signedWebhookRequest(app: INestApplication, payload: object) {
  const body = JSON.stringify(payload);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: WEBHOOK_SECRET,
  });
  return request(app.getHttpServer())
    .post('/v1/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', signature)
    .send(body);
}

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
    app = moduleRef.createNestApplication({ rawBody: true });
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

  // The webhook secret is real (from .env if the developer added one, a
  // fixed placeholder otherwise — see test/env-setup.ts); either way it's
  // the same secret this app is configured with, so
  // stripe.webhooks.constructEvent's verification is exercised for real,
  // satisfying the project's "never claim a webhook works without actually
  // running verification" rule without needing a live Stripe API call or
  // the Stripe CLI (decisions.md).
  describe('Stripe webhook — payment_intent.succeeded (Fulfil)', () => {
    it('rejects an incorrectly signed event with 400 and processes nothing', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', 't=1,v1=not-a-real-signature')
        .send(
          JSON.stringify({ id: 'evt_bad', type: 'payment_intent.succeeded' }),
        );

      expect(response.status).toBe(400);
      const stored = await prisma.stripeWebhookEvent.findUnique({
        where: { id: 'evt_bad' },
      });
      expect(stored).toBeNull();
    });

    it('marks the order paid, converts the reservation into a real stock decrement, and writes shipping details', async () => {
      const { token, skuId } = await createClientWithCart(2);
      const created = await request(app.getHttpServer())
        .post('/v1/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      const orderId = (created.body as OrderBody).id;
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });

      const stripePaymentIntentId = `pi_test_${orderId}`;
      await prisma.payment.create({
        data: {
          orderId,
          method: PaymentMethod.payment_intent,
          stripePaymentIntentId,
          amount: order.total,
          currency: 'usd',
          status: PaymentStatus.pending,
        },
      });

      const event = {
        id: `evt_${orderId}`,
        object: 'event',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: stripePaymentIntentId,
            object: 'payment_intent',
            metadata: { orderId },
            shipping: {
              name: 'Ada Lovelace',
              phone: '+15551234567',
              address: {
                line1: '1 Infinite Loop',
                line2: null,
                city: 'Cupertino',
                state: 'CA',
                postal_code: '95014',
                country: 'US',
              },
            },
          },
        },
      };

      const response = await signedWebhookRequest(app, event);
      expect(response.status).toBe(204);

      const paidOrder = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(paidOrder.status).toBe('paid');

      const sku = await prisma.sku.findUniqueOrThrow({ where: { id: skuId } });
      expect(sku.stock).toBe(8);
      expect(sku.reservedStock).toBe(0);

      const payment = await prisma.payment.findUniqueOrThrow({
        where: { stripePaymentIntentId },
      });
      expect(payment.status).toBe('succeeded');

      const shipping = await prisma.orderShippingDetails.findUniqueOrThrow({
        where: { orderId },
      });
      expect(shipping.recipientName).toBe('Ada Lovelace');
      expect(shipping.city).toBe('Cupertino');
      expect(shipping.country).toBe('US');

      const historyStatuses = await prisma.orderStatusHistory.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
      const paidRow = historyStatuses.find((row) => row.status === 'paid');
      expect(paidRow?.changedBy).toBeNull();

      const webhookEvent = await prisma.stripeWebhookEvent.findUniqueOrThrow({
        where: { id: event.id },
      });
      expect(webhookEvent.processedAt).not.toBeNull();

      // Stripe's at-least-once delivery: replaying the identical event must
      // not double-decrement stock.
      const replay = await signedWebhookRequest(app, event);
      expect(replay.status).toBe(204);
      const skuAfterReplay = await prisma.sku.findUniqueOrThrow({
        where: { id: skuId },
      });
      expect(skuAfterReplay.stock).toBe(8);
    });
  });

  // Real Postgres, but the Stripe client is stubbed for this describe block
  // specifically — the point is proving the DB-level race guard, not
  // exercising the real Stripe API (that's "Live Stripe API" below). Mirrors
  // the createOrder cart-claim regression test's approach: a second app
  // bound to the same container, one provider overridden.
  describe('Payment intent creation — concurrency', () => {
    let stubbedApp: INestApplication;
    let stripeStub: {
      paymentIntents: {
        create: jest.Mock;
        cancel: jest.Mock;
        retrieve: jest.Mock;
      };
    };

    beforeAll(async () => {
      stripeStub = {
        paymentIntents: {
          create: jest.fn(),
          cancel: jest.fn().mockResolvedValue({}),
          retrieve: jest.fn(),
        },
      };

      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .overrideProvider(STRIPE_CLIENT)
        .useValue(stripeStub)
        .compile();
      stubbedApp = moduleRef.createNestApplication({ rawBody: true });
      configureApp(stubbedApp);
      await stubbedApp.init();
    });

    afterAll(async () => {
      await stubbedApp.close();
    });

    it('creates exactly one usable payment intent when the same order is requested concurrently', async () => {
      const { token } = await createClientWithCart(1);
      const created = await request(app.getHttpServer())
        .post('/v1/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      const orderId = (created.body as OrderBody).id;

      let createCalls = 0;
      stripeStub.paymentIntents.create.mockImplementation(() => {
        createCalls += 1;
        return Promise.resolve({
          id: `pi_race_${createCalls}`,
          client_secret: `pi_race_${createCalls}_secret`,
        });
      });
      stripeStub.paymentIntents.retrieve.mockImplementation((id: string) =>
        Promise.resolve({ client_secret: `${id}_secret` }),
      );

      const agent = request(stubbedApp.getHttpServer());
      const [res1, res2] = await Promise.all([
        agent
          .post(`/v1/orders/${orderId}/payment-intent`)
          .set('Authorization', `Bearer ${token}`),
        agent
          .post(`/v1/orders/${orderId}/payment-intent`)
          .set('Authorization', `Bearer ${token}`),
      ]);

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      const body1 = res1.body as { paymentId: string; clientSecret: string };
      const body2 = res2.body as { paymentId: string; clientSecret: string };
      expect(body1.paymentId).toBe(body2.paymentId);
      expect(body1.clientSecret).toBe(body2.clientSecret);

      // Which defense actually resolves the race is a timing detail, not a
      // contract: the losing request might lose at the DB unique-constraint
      // (paymentIntents.create called twice, one cancelled) or might find
      // the winner's row via the existingPending fast path first
      // (paymentIntents.create called once). Either is correct — the
      // invariant that matters is a single surviving Payment row and no
      // permanently orphaned Stripe intent.
      if (stripeStub.paymentIntents.create.mock.calls.length === 2) {
        expect(stripeStub.paymentIntents.cancel).toHaveBeenCalledTimes(1);
      } else {
        expect(stripeStub.paymentIntents.cancel).not.toHaveBeenCalled();
      }

      const payments = await prisma.payment.findMany({
        where: { orderId, method: PaymentMethod.payment_intent },
      });
      expect(payments).toHaveLength(1);
    });
  });

  (hasRealStripeKey ? describe : describe.skip)('Live Stripe API', () => {
    it('createPaymentIntent returns a real Stripe client secret', async () => {
      const { token } = await createClientWithCart(1);
      const created = await request(app.getHttpServer())
        .post('/v1/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      const orderId = (created.body as OrderBody).id;

      const response = await request(app.getHttpServer())
        .post(`/v1/orders/${orderId}/payment-intent`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(201);
      const body = response.body as { clientSecret: string; paymentId: string };
      expect(body.clientSecret).toMatch(/^pi_.+_secret_.+$/);

      const payment = await prisma.payment.findUniqueOrThrow({
        where: { id: body.paymentId },
      });
      expect(payment.stripePaymentIntentId).toMatch(/^pi_/);
    });

    it('createPaymentLinkCheckout returns a real Stripe-hosted checkout URL', async () => {
      const { token, skuId } = await createClientWithCart(1);

      const response = await request(app.getHttpServer())
        .post('/v1/checkout/payment-link')
        .set('Authorization', `Bearer ${token}`)
        .send({ skuId, quantity: 1 });

      expect(response.status).toBe(201);
      const body = response.body as { checkoutUrl: string; order: OrderBody };
      expect(body.checkoutUrl).toContain('https://buy.stripe.com/');
      expect(body.checkoutUrl).toContain(
        `client_reference_id=${body.order.id}`,
      );

      const sku = await prisma.sku.findUniqueOrThrow({ where: { id: skuId } });
      expect(sku.reservedStock).toBe(0); // Payment Links never reserve.
    });
  });
});
