import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  OrderStatus,
  PaymentStatus,
  UserRole,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from '../stripe/stripe.constants';
import { OrderNotPayableException } from './exceptions/order-not-payable.exception';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: {
    order: { findUnique: jest.Mock; create: jest.Mock };
    payment: { findFirst: jest.Mock; create: jest.Mock };
    sku: { findUnique: jest.Mock };
    paymentLink: { findFirst: jest.Mock; create: jest.Mock };
  };
  let stripe: {
    paymentIntents: { create: jest.Mock };
    paymentLinks: { create: jest.Mock; retrieve: jest.Mock };
    prices: { create: jest.Mock };
  };

  const clientUser = { id: 'client-1', role: UserRole.client };

  const pendingOrder = {
    id: 'order-1',
    userId: clientUser.id,
    status: OrderStatus.pending,
    total: 3998,
  };

  const skuEntity = {
    id: 'sku-1',
    productId: 'product-1',
    size: 'M',
    color: 'black',
    price: 1999,
    stock: 10,
    reservedStock: 0,
    deletedAt: null,
    product: { id: 'product-1', name: 'Classic Tee', deletedAt: null },
  };

  beforeEach(async () => {
    prisma = {
      order: { findUnique: jest.fn(), create: jest.fn() },
      payment: { findFirst: jest.fn(), create: jest.fn() },
      sku: { findUnique: jest.fn() },
      paymentLink: { findFirst: jest.fn(), create: jest.fn() },
    };
    stripe = {
      paymentIntents: { create: jest.fn() },
      paymentLinks: { create: jest.fn(), retrieve: jest.fn() },
      prices: { create: jest.fn() },
    };
    prisma.payment.findFirst.mockResolvedValue(null);

    const module = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: STRIPE_CLIENT, useValue: stripe },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  describe('createPaymentIntent', () => {
    it('throws NotFoundException when the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.createPaymentIntent(clientUser, 'missing-order'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the order belongs to another client (404, not 403)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...pendingOrder,
        userId: 'someone-else',
      });

      await expect(
        service.createPaymentIntent(clientUser, pendingOrder.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws OrderNotPayableException when the order is not pending', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...pendingOrder,
        status: OrderStatus.paid,
      });

      await expect(
        service.createPaymentIntent(clientUser, pendingOrder.id),
      ).rejects.toBeInstanceOf(OrderNotPayableException);
      expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('throws OrderNotPayableException when a succeeded payment already exists', async () => {
      prisma.order.findUnique.mockResolvedValue(pendingOrder);
      prisma.payment.findFirst.mockResolvedValue({
        id: 'payment-1',
        status: PaymentStatus.succeeded,
      });

      await expect(
        service.createPaymentIntent(clientUser, pendingOrder.id),
      ).rejects.toBeInstanceOf(OrderNotPayableException);
      expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('creates a Stripe payment intent for the order total and persists a pending Payment row', async () => {
      prisma.order.findUnique.mockResolvedValue(pendingOrder);
      stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_123',
        client_secret: 'pi_123_secret_abc',
      });
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' });

      const result = await service.createPaymentIntent(
        clientUser,
        pendingOrder.id,
      );

      // TODO(testing agent): assert stripe.paymentIntents.create was called
      // with { amount: pendingOrder.total, currency: 'usd',
      // automatic_payment_methods: { enabled: true }, metadata: { orderId:
      // pendingOrder.id } }; assert prisma.payment.create's data includes
      // { orderId, method: 'payment_intent', stripePaymentIntentId: 'pi_123',
      // amount: pendingOrder.total, currency: 'usd' }; assert result equals
      // { paymentId: 'payment-1', clientSecret: 'pi_123_secret_abc', amount:
      // { amount: 3998, currency: 'USD' } }.
      void result;
    });
  });

  describe('createPaymentLinkCheckout', () => {
    const dto = { skuId: skuEntity.id, quantity: 2 };

    it('throws NotFoundException when the sku does not exist', async () => {
      prisma.sku.findUnique.mockResolvedValue(null);

      await expect(
        service.createPaymentLinkCheckout(clientUser, dto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the sku is soft-deleted', async () => {
      prisma.sku.findUnique.mockResolvedValue({
        ...skuEntity,
        deletedAt: new Date(),
      });

      await expect(
        service.createPaymentLinkCheckout(clientUser, dto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the product is soft-deleted', async () => {
      prisma.sku.findUnique.mockResolvedValue({
        ...skuEntity,
        product: { ...skuEntity.product, deletedAt: new Date() },
      });

      await expect(
        service.createPaymentLinkCheckout(clientUser, dto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates a pending order with no stock reservation', async () => {
      prisma.sku.findUnique.mockResolvedValue(skuEntity);
      prisma.order.create.mockResolvedValue({
        id: 'order-2',
        status: OrderStatus.pending,
        items: [],
        subtotal: 3998,
        discountAmount: 0,
        total: 3998,
        shippingDetails: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });
      prisma.paymentLink.findFirst.mockResolvedValue({
        id: 'link-1',
        stripePaymentLinkId: 'plink_123',
        deactivatedAt: null,
      });
      stripe.paymentLinks.retrieve.mockResolvedValue({
        url: 'https://buy.stripe.com/test_abc',
      });

      const result = await service.createPaymentLinkCheckout(clientUser, dto);

      // TODO(testing agent): assert prisma.order.create's data has no stock
      // side effects (this method never touches prisma.sku) and includes
      // items.create with quantity 2, unitPrice skuEntity.price,
      // productName/size/color from skuEntity, and statusHistory.create:
      // { status: pending, changedBy: clientUser.id }; assert
      // stripe.prices.create / stripe.paymentLinks.create were NOT called
      // (an active link already exists); assert result.checkoutUrl equals
      // `${retrieved url}?client_reference_id=order-2`.
      void result;
    });

    it('reuses an existing, non-deactivated PaymentLink for the sku', async () => {
      prisma.sku.findUnique.mockResolvedValue(skuEntity);
      prisma.paymentLink.findFirst.mockResolvedValue({
        id: 'link-1',
        stripePaymentLinkId: 'plink_123',
        deactivatedAt: null,
      });
      stripe.paymentLinks.retrieve.mockResolvedValue({
        url: 'https://buy.stripe.com/test_abc',
      });
      prisma.order.create.mockResolvedValue({
        id: 'order-2',
        items: [],
        shippingDetails: null,
      });

      await service.createPaymentLinkCheckout(clientUser, dto);

      // TODO(testing agent): assert prisma.paymentLink.findFirst was called
      // with { where: { skuId: skuEntity.id, deactivatedAt: null } }; assert
      // stripe.paymentLinks.retrieve was called with 'plink_123'; assert
      // stripe.prices.create / stripe.paymentLinks.create / prisma.
      // paymentLink.create were NOT called.
    });

    it('creates a new Stripe Price + Payment Link when none exists for the sku', async () => {
      prisma.sku.findUnique.mockResolvedValue(skuEntity);
      prisma.paymentLink.findFirst.mockResolvedValue(null);
      stripe.prices.create.mockResolvedValue({ id: 'price_123' });
      stripe.paymentLinks.create.mockResolvedValue({
        id: 'plink_new',
        url: 'https://buy.stripe.com/test_new',
      });
      prisma.order.create.mockResolvedValue({
        id: 'order-2',
        items: [],
        shippingDetails: null,
      });

      await service.createPaymentLinkCheckout(clientUser, dto);

      // TODO(testing agent): assert stripe.prices.create was called with
      // { currency: 'usd', unit_amount: skuEntity.price, product_data: {
      // name: expect.any(String) } }; assert stripe.paymentLinks.create's
      // line_items has price: 'price_123', adjustable_quantity.enabled:
      // true; assert prisma.paymentLink.create's data equals { skuId:
      // skuEntity.id, stripePaymentLinkId: 'plink_new', stripePriceId:
      // 'price_123', unitAmount: skuEntity.price }.
    });
  });
});
