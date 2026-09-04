import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from '../stripe/stripe.constants';
import { buildUniqueConstraintError } from '../test-utils/prisma-error-fixtures';
import { buildClientUser } from '../test-utils/user-fixtures';
import { OrderNotPayableException } from './exceptions/order-not-payable.exception';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: {
    order: { findUnique: jest.Mock; create: jest.Mock };
    payment: {
      findFirst: jest.Mock;
      findFirstOrThrow: jest.Mock;
      create: jest.Mock;
    };
    sku: { findUnique: jest.Mock };
    paymentLink: {
      findFirst: jest.Mock;
      findFirstOrThrow: jest.Mock;
      create: jest.Mock;
    };
  };
  let stripe: {
    paymentIntents: {
      create: jest.Mock;
      cancel: jest.Mock;
      retrieve: jest.Mock;
    };
    paymentLinks: { create: jest.Mock; retrieve: jest.Mock; update: jest.Mock };
    prices: { create: jest.Mock };
  };

  const pendingClaimConflict = buildUniqueConstraintError(
    'payments_order_id_pending_key',
  );
  const activeLinkConflict = buildUniqueConstraintError(
    'payment_links_sku_id_active_key',
  );

  const clientUser = buildClientUser();

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
      payment: {
        findFirst: jest.fn(),
        findFirstOrThrow: jest.fn(),
        create: jest.fn(),
      },
      sku: { findUnique: jest.fn() },
      paymentLink: {
        findFirst: jest.fn(),
        findFirstOrThrow: jest.fn(),
        create: jest.fn(),
      },
    };
    stripe = {
      paymentIntents: {
        create: jest.fn(),
        cancel: jest.fn().mockResolvedValue({}),
        retrieve: jest.fn(),
      },
      paymentLinks: {
        create: jest.fn(),
        retrieve: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
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

      expect(stripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: pendingOrder.total,
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: { orderId: pendingOrder.id },
      });
      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: {
          orderId: pendingOrder.id,
          method: PaymentMethod.payment_intent,
          stripePaymentIntentId: 'pi_123',
          amount: pendingOrder.total,
          currency: 'usd',
        },
      });
      expect(result).toEqual({
        paymentId: 'payment-1',
        clientSecret: 'pi_123_secret_abc',
        amount: { amount: 3998, currency: 'USD' },
      });
    });

    it('reuses an existing pending payment intent instead of creating a new one', async () => {
      prisma.order.findUnique.mockResolvedValue(pendingOrder);
      prisma.payment.findFirst
        .mockResolvedValueOnce(null) // succeeded-payment check
        .mockResolvedValueOnce({
          id: 'payment-1',
          amount: 3998,
          stripePaymentIntentId: 'pi_existing',
        }); // existing-pending check
      stripe.paymentIntents.retrieve.mockResolvedValue({
        client_secret: 'pi_existing_secret',
      });

      const result = await service.createPaymentIntent(
        clientUser,
        pendingOrder.id,
      );

      expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith(
        'pi_existing',
      );
      expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        paymentId: 'payment-1',
        clientSecret: 'pi_existing_secret',
        amount: { amount: 3998, currency: 'USD' },
      });
    });

    it('cancels the redundant intent and reuses the winner when a concurrent request already claimed the order', async () => {
      prisma.order.findUnique.mockResolvedValue(pendingOrder);
      stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_loser',
        client_secret: 'pi_loser_secret',
      });
      prisma.payment.create.mockRejectedValue(pendingClaimConflict);
      prisma.payment.findFirstOrThrow.mockResolvedValue({
        id: 'payment-winner',
        amount: 3998,
        stripePaymentIntentId: 'pi_winner',
      });
      stripe.paymentIntents.retrieve.mockResolvedValue({
        client_secret: 'pi_winner_secret',
      });

      const result = await service.createPaymentIntent(
        clientUser,
        pendingOrder.id,
      );

      expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_loser');
      expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_winner');
      expect(result).toEqual({
        paymentId: 'payment-winner',
        clientSecret: 'pi_winner_secret',
        amount: { amount: 3998, currency: 'USD' },
      });
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

      expect(prisma.order.create).toHaveBeenCalledWith({
        data: {
          userId: clientUser.id,
          subtotal: skuEntity.price * dto.quantity,
          total: skuEntity.price * dto.quantity,
          items: {
            create: {
              skuId: skuEntity.id,
              productId: skuEntity.productId,
              quantity: dto.quantity,
              unitPrice: skuEntity.price,
              productName: skuEntity.product.name,
              size: skuEntity.size,
              color: skuEntity.color,
            },
          },
          statusHistory: {
            create: { status: OrderStatus.pending, changedBy: clientUser.id },
          },
        },
        include: { items: true, shippingDetails: true },
      });
      expect(stripe.prices.create).not.toHaveBeenCalled();
      expect(stripe.paymentLinks.create).not.toHaveBeenCalled();
      expect(result.checkoutUrl).toBe(
        'https://buy.stripe.com/test_abc?client_reference_id=order-2',
      );
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

      expect(prisma.paymentLink.findFirst).toHaveBeenCalledWith({
        where: { skuId: skuEntity.id, deactivatedAt: null },
      });
      expect(stripe.paymentLinks.retrieve).toHaveBeenCalledWith('plink_123');
      expect(stripe.prices.create).not.toHaveBeenCalled();
      expect(stripe.paymentLinks.create).not.toHaveBeenCalled();
      expect(prisma.paymentLink.create).not.toHaveBeenCalled();
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

      expect(stripe.prices.create).toHaveBeenCalledWith({
        currency: 'usd',
        unit_amount: skuEntity.price,
        product_data: { name: expect.any(String) as string },
      });
      expect(stripe.paymentLinks.create).toHaveBeenCalledWith({
        line_items: [
          {
            price: 'price_123',
            quantity: 1,
            adjustable_quantity: { enabled: true, minimum: 1 },
          },
        ],
      });
      expect(prisma.paymentLink.create).toHaveBeenCalledWith({
        data: {
          skuId: skuEntity.id,
          stripePaymentLinkId: 'plink_new',
          stripePriceId: 'price_123',
          unitAmount: skuEntity.price,
        },
      });
    });

    it('deactivates the redundant link and reuses the winner when a concurrent first-time creation already claimed the sku', async () => {
      prisma.sku.findUnique.mockResolvedValue(skuEntity);
      prisma.paymentLink.findFirst.mockResolvedValue(null);
      stripe.prices.create.mockResolvedValue({ id: 'price_loser' });
      stripe.paymentLinks.create.mockResolvedValue({
        id: 'plink_loser',
        url: 'https://buy.stripe.com/test_loser',
      });
      prisma.paymentLink.create.mockRejectedValue(activeLinkConflict);
      prisma.paymentLink.findFirstOrThrow.mockResolvedValue({
        stripePaymentLinkId: 'plink_winner',
      });
      stripe.paymentLinks.retrieve.mockResolvedValue({
        url: 'https://buy.stripe.com/test_winner',
      });
      prisma.order.create.mockResolvedValue({
        id: 'order-2',
        items: [],
        shippingDetails: null,
      });

      const result = await service.createPaymentLinkCheckout(clientUser, dto);

      expect(stripe.paymentLinks.update).toHaveBeenCalledWith('plink_loser', {
        active: false,
      });
      expect(stripe.paymentLinks.retrieve).toHaveBeenCalledWith('plink_winner');
      expect(result.checkoutUrl).toBe(
        'https://buy.stripe.com/test_winner?client_reference_id=order-2',
      );
    });
  });
});
