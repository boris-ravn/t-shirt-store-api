import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from '../stripe/stripe.constants';
import { StripeWebhookService } from './stripe-webhook.service';

// $transaction mocking follows orders.service.spec.ts's pattern: the
// callback runs against the same mock object as `prisma`.
describe('StripeWebhookService', () => {
  let service: StripeWebhookService;
  let prisma: {
    stripeWebhookEvent: { create: jest.Mock; update: jest.Mock };
    order: { updateMany: jest.Mock };
    orderItem: {
      findMany: jest.Mock;
      findFirstOrThrow: jest.Mock;
      update: jest.Mock;
    };
    sku: { update: jest.Mock; findUniqueOrThrow: jest.Mock };
    payment: { updateMany: jest.Mock; create: jest.Mock };
    paymentLink: { updateMany: jest.Mock; findUnique: jest.Mock };
    orderStatusHistory: { create: jest.Mock };
    orderShippingDetails: { create: jest.Mock };
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let stripe: {
    webhooks: { constructEvent: jest.Mock };
    checkout: { sessions: { listLineItems: jest.Mock } };
  };

  const eventIdConflict = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    {
      code: 'P2002',
      clientVersion: '7.10.0',
      meta: {
        driverAdapterError: {
          cause: { constraint: { index: 'stripe_webhook_events_pkey' } },
        },
      },
    },
  );

  const paymentIntentSucceededEvent = {
    id: 'evt_1',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_123',
        metadata: { orderId: 'order-1' },
        shipping: null,
      },
    },
  };

  const checkoutSessionCompletedEvent = {
    id: 'evt_2',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_123',
        client_reference_id: 'order-2',
        amount_total: 3998,
        currency: 'usd',
        payment_link: 'plink_123',
        customer_details: { phone: null },
        collected_information: null,
      },
    },
  };

  beforeEach(async () => {
    prisma = {
      stripeWebhookEvent: { create: jest.fn(), update: jest.fn() },
      order: { updateMany: jest.fn() },
      orderItem: {
        findMany: jest.fn(),
        findFirstOrThrow: jest.fn(),
        update: jest.fn(),
      },
      sku: { update: jest.fn(), findUniqueOrThrow: jest.fn() },
      payment: { updateMany: jest.fn(), create: jest.fn() },
      paymentLink: { updateMany: jest.fn(), findUnique: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
      orderShippingDetails: { create: jest.fn() },
      $executeRaw: jest.fn(),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    stripe = {
      webhooks: { constructEvent: jest.fn() },
      checkout: { sessions: { listLineItems: jest.fn() } },
    };

    const module = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: STRIPE_CLIENT, useValue: stripe },
      ],
    }).compile();

    service = module.get(StripeWebhookService);
  });

  describe('constructEvent', () => {
    it('delegates to stripe.webhooks.constructEvent', () => {
      const rawBody = Buffer.from('{}');
      stripe.webhooks.constructEvent.mockReturnValue(
        paymentIntentSucceededEvent,
      );

      const result = service.constructEvent(rawBody, 'sig', 'whsec_test');

      // TODO(testing agent): assert stripe.webhooks.constructEvent was
      // called with (rawBody, 'sig', 'whsec_test'); assert result is the
      // mocked event.
      void result;
    });
  });

  describe('handleEvent — idempotency', () => {
    it('short-circuits on a duplicate event id without processing', async () => {
      prisma.stripeWebhookEvent.create.mockRejectedValue(eventIdConflict);

      await service.handleEvent(paymentIntentSucceededEvent as never);

      // TODO(testing agent): assert prisma.$transaction was NOT called;
      // assert prisma.stripeWebhookEvent.update was NOT called.
    });

    it('marks processedAt on an event type with no handler (no-op)', async () => {
      prisma.stripeWebhookEvent.create.mockResolvedValue({});

      await service.handleEvent({
        id: 'evt_3',
        type: 'charge.refunded',
        data: { object: {} },
      } as never);

      // TODO(testing agent): assert prisma.stripeWebhookEvent.update was
      // called with { where: { id: 'evt_3' }, data: { processedAt:
      // expect.any(Date) } }; assert prisma.$transaction was NOT called.
    });

    it('leaves processedAt unset when processing throws', async () => {
      prisma.stripeWebhookEvent.create.mockResolvedValue({});
      prisma.$transaction.mockRejectedValue(new Error('db down'));

      await service.handleEvent(paymentIntentSucceededEvent as never);

      // TODO(testing agent): assert prisma.stripeWebhookEvent.update was NOT
      // called, and handleEvent resolved rather than throwing.
    });
  });

  describe('handleEvent — payment_intent.succeeded (Fulfil)', () => {
    beforeEach(() => {
      prisma.stripeWebhookEvent.create.mockResolvedValue({});
    });

    it('is a no-op when the order is not pending (already fulfilled by another event)', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      await service.handleEvent(paymentIntentSucceededEvent as never);

      // TODO(testing agent): assert prisma.sku.update, prisma.payment.
      // updateMany, prisma.orderStatusHistory.create were NOT called; assert
      // prisma.stripeWebhookEvent.update WAS called (processing "succeeded"
      // even though it did nothing).
    });

    it('decrements stock and reservedStock together for every order item', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.orderItem.findMany.mockResolvedValue([
        { skuId: 'sku-1', quantity: 2 },
      ]);

      await service.handleEvent(paymentIntentSucceededEvent as never);

      // TODO(testing agent): assert prisma.sku.update was called with
      // { where: { id: 'sku-1' }, data: { stock: { decrement: 2 },
      // reservedStock: { decrement: 2 } } } — no availability guard, unlike
      // Reserve/Direct sale.
    });

    it('marks the matching pending Payment row succeeded', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.orderItem.findMany.mockResolvedValue([]);

      await service.handleEvent(paymentIntentSucceededEvent as never);

      // TODO(testing agent): assert prisma.payment.updateMany was called
      // with { where: { stripePaymentIntentId: 'pi_123', status: 'pending'
      // }, data: { status: 'succeeded' } }.
    });

    it('writes order_shipping_details when the intent carries a shipping address', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.orderItem.findMany.mockResolvedValue([]);
      const eventWithShipping = {
        ...paymentIntentSucceededEvent,
        data: {
          object: {
            ...paymentIntentSucceededEvent.data.object,
            shipping: {
              name: 'Ada Lovelace',
              phone: '+15551234',
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

      await service.handleEvent(eventWithShipping as never);

      // TODO(testing agent): assert prisma.orderShippingDetails.create's
      // data matches the shipping object above, keyed on orderId: 'order-1'.
    });

    it('inserts the paid status-history row with changedBy: null (webhook-driven, no human)', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.orderItem.findMany.mockResolvedValue([]);

      await service.handleEvent(paymentIntentSucceededEvent as never);

      // TODO(testing agent): assert prisma.orderStatusHistory.create was
      // called with { data: { orderId: 'order-1', status: 'paid',
      // changedBy: null } }.
    });
  });

  describe('handleEvent — checkout.session.completed (Direct sale)', () => {
    beforeEach(() => {
      prisma.stripeWebhookEvent.create.mockResolvedValue({});
      stripe.checkout.sessions.listLineItems.mockResolvedValue({
        data: [{ quantity: 3 }],
      });
      prisma.orderItem.findFirstOrThrow.mockResolvedValue({
        id: 'item-1',
        skuId: 'sku-2',
      });
      prisma.sku.findUniqueOrThrow.mockResolvedValue({
        id: 'sku-2',
        stock: 5,
        reservedStock: 0,
      });
    });

    it('is a no-op when the order is not pending (already fulfilled by another event)', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      await service.handleEvent(checkoutSessionCompletedEvent as never);

      // TODO(testing agent): assert prisma.orderItem.update, prisma.
      // $executeRaw, prisma.payment.create were NOT called.
    });

    it('corrects order_item.quantity and the order total from the real Stripe line items, not the original request', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      await service.handleEvent(checkoutSessionCompletedEvent as never);

      // TODO(testing agent): assert stripe.checkout.sessions.listLineItems
      // was called with 'cs_123'; assert prisma.order.updateMany's data
      // includes { status: 'paid', subtotal: 3998, total: 3998 } (from
      // session.amount_total, not the provisional order); assert
      // prisma.orderItem.update was called with { where: { id: 'item-1' },
      // data: { quantity: 3 } } (from the line item, not the original DTO).
    });

    it('proceeds to mark the order paid even when the Direct-sale stock guard affects 0 rows', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.sku.findUniqueOrThrow.mockResolvedValue({
        id: 'sku-2',
        stock: 5,
        reservedStock: 5,
      });

      await service.handleEvent(checkoutSessionCompletedEvent as never);

      // TODO(testing agent): assert prisma.payment.create and
      // prisma.orderStatusHistory.create WERE still called — the payment
      // already succeeded on Stripe's side, this isn't unwound (README §9).
    });

    it('deactivates the payment link once available stock hits zero', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.sku.findUniqueOrThrow.mockResolvedValue({
        id: 'sku-2',
        stock: 3,
        reservedStock: 3,
      });

      await service.handleEvent(checkoutSessionCompletedEvent as never);

      // TODO(testing agent): assert prisma.paymentLink.updateMany was
      // called with { where: { skuId: 'sku-2', deactivatedAt: null }, data:
      // { deactivatedAt: expect.any(Date) } }.
    });

    it('does not deactivate the payment link while stock remains available', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.sku.findUniqueOrThrow.mockResolvedValue({
        id: 'sku-2',
        stock: 5,
        reservedStock: 0,
      });

      await service.handleEvent(checkoutSessionCompletedEvent as never);

      // TODO(testing agent): assert prisma.paymentLink.updateMany was NOT
      // called.
    });

    it('creates a succeeded Payment row for the payment-link method', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.paymentLink.findUnique.mockResolvedValue({ id: 'link-1' });

      await service.handleEvent(checkoutSessionCompletedEvent as never);

      // TODO(testing agent): assert prisma.payment.create's data equals
      // { orderId: 'order-2', method: 'payment_link', paymentLinkId:
      // 'link-1', stripeCheckoutSessionId: 'cs_123', amount: 3998,
      // currency: 'usd', status: 'succeeded' }.
    });

    it('writes order_shipping_details from collected_information when present', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      const eventWithShipping = {
        ...checkoutSessionCompletedEvent,
        data: {
          object: {
            ...checkoutSessionCompletedEvent.data.object,
            collected_information: {
              shipping_details: {
                name: 'Ada Lovelace',
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
        },
      };

      await service.handleEvent(eventWithShipping as never);

      // TODO(testing agent): assert prisma.orderShippingDetails.create's
      // data matches the shipping_details object above, keyed on orderId:
      // 'order-2', with phone from session.customer_details.phone.
    });

    it('throws when the session carries no client_reference_id', async () => {
      const eventWithoutOrder = {
        ...checkoutSessionCompletedEvent,
        data: {
          object: {
            ...checkoutSessionCompletedEvent.data.object,
            client_reference_id: null,
          },
        },
      };

      await service.handleEvent(eventWithoutOrder as never);

      // TODO(testing agent): assert prisma.stripeWebhookEvent.update was NOT
      // called (processedAt stays null — a partial failure to retry).
    });
  });
});
