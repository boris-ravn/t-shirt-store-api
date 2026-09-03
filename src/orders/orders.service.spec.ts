import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CartService } from '../cart/cart.service';
import { CartEmptyException } from '../cart/exceptions/cart-empty.exception';
import { OrderStatus, UserRole } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { PromoCodeExhaustedException } from '../promos/exceptions/promo-code-exhausted.exception';
import { PromoCodeExpiredException } from '../promos/exceptions/promo-code-expired.exception';
import { PromoCodeInvalidException } from '../promos/exceptions/promo-code-invalid.exception';
import { PromoMinimumNotMetException } from '../promos/exceptions/promo-minimum-not-met.exception';
import { InsufficientStockException } from './exceptions/insufficient-stock.exception';
import { InvalidStatusTransitionException } from './exceptions/invalid-status-transition.exception';
import { OrdersService } from './orders.service';

// $transaction mocking follows auth.service.spec.ts's pattern: the callback
// runs against the same mock object as `prisma`, so tx.order.x ===
// prisma.order.x for assertion purposes.
describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: {
    order: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    orderItem: { findMany: jest.Mock };
    orderStatusHistory: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    sku: { update: jest.Mock; findUniqueOrThrow: jest.Mock };
    promoCode: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
    cartItem: { deleteMany: jest.Mock };
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let cartService: { getOrCreate: jest.Mock };

  const clientUser = { id: 'client-1', role: UserRole.client };
  const managerUser = { id: 'manager-1', role: UserRole.manager };
  const deliveryUser = { id: 'delivery-1', role: UserRole.delivery_person };

  // Shape matches CartItemResponseDto's nested SkuResponseDto (price as
  // Money, not the raw Prisma column) — this is what cartService.getOrCreate
  // actually returns, and createOrder reads item.sku.price.amount.
  const skuA = {
    id: 'sku-a',
    size: 'M',
    color: 'black',
    price: { amount: 1999, currency: 'USD' },
    availableQuantity: 10,
  };
  const cartWithOneItem = {
    id: 'cart-1',
    items: [
      {
        id: 'cart-item-1',
        quantity: 2,
        sku: skuA,
        product: { id: 'product-1', name: 'Classic Tee' },
      },
    ],
    subtotal: { amount: 3998, currency: 'USD' },
  };
  const emptyCart = {
    id: 'cart-1',
    items: [],
    subtotal: { amount: 0, currency: 'USD' },
  };

  const activePromo = {
    id: 'promo-1',
    code: 'WELCOME15',
    discountType: 'percentage',
    discountValue: 15,
    minPurchaseAmount: null,
    expiresAt: new Date('2099-01-01T00:00:00Z'),
    usageLimit: 500,
    timesRedeemed: 10,
    isActive: true,
  };

  const orderEntity = {
    id: 'order-1',
    userId: clientUser.id,
    status: OrderStatus.pending,
    subtotal: 3998,
    promoCodeId: null,
    discountAmount: 0,
    total: 3998,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    items: [],
    shippingDetails: null,
    user: {
      id: clientUser.id,
      email: 'a@example.com',
      firstName: 'A',
      lastName: 'B',
    },
    promoCode: null,
  };

  beforeEach(async () => {
    prisma = {
      order: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
      orderItem: { findMany: jest.fn() },
      orderStatusHistory: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      sku: { update: jest.fn(), findUniqueOrThrow: jest.fn() },
      promoCode: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      cartItem: { deleteMany: jest.fn() },
      $executeRaw: jest.fn(),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    cartService = { getOrCreate: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: CartService, useValue: cartService },
      ],
    }).compile();

    service = module.get(OrdersService);
  });

  describe('createOrder', () => {
    it('throws CartEmptyException when the cart has no items', async () => {
      cartService.getOrCreate.mockResolvedValue(emptyCart);

      await expect(service.createOrder(clientUser, {})).rejects.toBeInstanceOf(
        CartEmptyException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws PromoCodeInvalidException before opening a transaction when the code does not exist', async () => {
      cartService.getOrCreate.mockResolvedValue(cartWithOneItem);
      prisma.promoCode.findUnique.mockResolvedValue(null);

      await expect(
        service.createOrder(clientUser, { promoCode: 'NOPE' }),
      ).rejects.toBeInstanceOf(PromoCodeInvalidException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws PromoCodeExpiredException for an expired code', async () => {
      cartService.getOrCreate.mockResolvedValue(cartWithOneItem);
      prisma.promoCode.findUnique.mockResolvedValue({
        ...activePromo,
        expiresAt: new Date('2020-01-01T00:00:00Z'),
      });

      await expect(
        service.createOrder(clientUser, { promoCode: 'WELCOME15' }),
      ).rejects.toBeInstanceOf(PromoCodeExpiredException);
    });

    it('throws PromoCodeExhaustedException when timesRedeemed >= usageLimit', async () => {
      cartService.getOrCreate.mockResolvedValue(cartWithOneItem);
      prisma.promoCode.findUnique.mockResolvedValue({
        ...activePromo,
        timesRedeemed: 500,
        usageLimit: 500,
      });

      await expect(
        service.createOrder(clientUser, { promoCode: 'WELCOME15' }),
      ).rejects.toBeInstanceOf(PromoCodeExhaustedException);
    });

    it('throws PromoMinimumNotMetException when subtotal is below the minimum', async () => {
      cartService.getOrCreate.mockResolvedValue(cartWithOneItem);
      prisma.promoCode.findUnique.mockResolvedValue({
        ...activePromo,
        minPurchaseAmount: 10000,
      });

      await expect(
        service.createOrder(clientUser, { promoCode: 'WELCOME15' }),
      ).rejects.toBeInstanceOf(PromoMinimumNotMetException);
    });

    it('throws InsufficientStockException and does not create an order when a Reserve guard affects 0 rows', async () => {
      cartService.getOrCreate.mockResolvedValue(cartWithOneItem);
      prisma.$executeRaw.mockResolvedValue(0);
      prisma.sku.findUniqueOrThrow.mockResolvedValue({
        ...skuA,
        stock: 1,
        reservedStock: 0,
      });

      await expect(service.createOrder(clientUser, {})).rejects.toBeInstanceOf(
        InsufficientStockException,
      );
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('re-evaluates and throws the specific reason when the promo redemption guard loses the race', async () => {
      cartService.getOrCreate.mockResolvedValue(cartWithOneItem);
      prisma.promoCode.findUnique.mockResolvedValue(activePromo);
      // Reserve succeeds, promo redemption guard fails (0 rows) — e.g. a
      // concurrent order just exhausted the usage limit.
      prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      prisma.promoCode.findUniqueOrThrow.mockResolvedValue({
        ...activePromo,
        timesRedeemed: 500,
        usageLimit: 500,
      });

      await expect(
        service.createOrder(clientUser, { promoCode: 'WELCOME15' }),
      ).rejects.toBeInstanceOf(PromoCodeExhaustedException);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('reserves stock, creates the order with snapshot items and the initial pending history row, and clears the cart', async () => {
      cartService.getOrCreate.mockResolvedValue(cartWithOneItem);
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.order.create.mockResolvedValue(orderEntity);

      const result = await service.createOrder(clientUser, {});

      expect(prisma.$executeRaw).toHaveBeenCalledWith(
        expect.any(Array),
        2,
        skuA.id,
        2,
      );
      expect(prisma.order.create).toHaveBeenCalledWith({
        data: {
          userId: clientUser.id,
          subtotal: 3998,
          promoCodeId: undefined,
          discountAmount: 0,
          total: 3998,
          items: {
            create: [
              {
                skuId: skuA.id,
                productId: 'product-1',
                quantity: 2,
                unitPrice: skuA.price.amount,
                productName: 'Classic Tee',
                size: skuA.size,
                color: skuA.color,
              },
            ],
          },
          statusHistory: {
            create: { status: OrderStatus.pending, changedBy: clientUser.id },
          },
        },
        include: {
          items: true,
          shippingDetails: true,
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          promoCode: { select: { id: true, code: true } },
        },
      });
      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: cartWithOneItem.id },
      });
      expect(result).not.toHaveProperty('user');
      expect(result).not.toHaveProperty('promoCode');
    });
  });

  describe('listOrders', () => {
    const baseQuery = { limit: 20, offset: 0, sort: '-createdAt' as const };

    it('throws ForbiddenException when a non-delivery_person passes deliveredBy=me', async () => {
      await expect(
        service.listOrders(clientUser, { ...baseQuery, deliveredBy: 'me' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it("scopes a client's list to their own orders and returns OrderResponseDto", async () => {
      prisma.order.findMany.mockResolvedValue([orderEntity]);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.listOrders(clientUser, baseQuery);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [{ userId: clientUser.id }, {}] },
        }),
      );
      expect(result.data[0]).not.toHaveProperty('user');
      expect(result.data[0]).not.toHaveProperty('promoCode');
    });

    it("does not scope a manager's list by userId and returns OrderAdminResponseDto", async () => {
      prisma.order.findMany.mockResolvedValue([orderEntity]);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.listOrders(managerUser, baseQuery);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{}, {}] } }),
      );
      expect(result.data[0]).toHaveProperty('user', orderEntity.user);
      expect(result.data[0]).toHaveProperty('promoCode', orderEntity.promoCode);
    });

    it("scopes a delivery person's list to shipped orders or their own deliveries", async () => {
      prisma.order.findMany.mockResolvedValue([orderEntity]);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.listOrders(deliveryUser, baseQuery);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                OR: [
                  { status: OrderStatus.shipped },
                  {
                    status: OrderStatus.delivered,
                    statusHistory: {
                      some: {
                        changedBy: deliveryUser.id,
                        status: OrderStatus.delivered,
                      },
                    },
                  },
                ],
              },
              {},
            ],
          },
        }),
      );
      expect(result.data[0]).not.toHaveProperty('user');
    });

    it('deliveredBy=me narrows a delivery person to only their own delivered orders (no shipped)', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);

      await service.listOrders(deliveryUser, {
        ...baseQuery,
        deliveredBy: 'me',
      });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                status: OrderStatus.delivered,
                statusHistory: {
                  some: {
                    changedBy: deliveryUser.id,
                    status: OrderStatus.delivered,
                  },
                },
              },
              {},
            ],
          },
        }),
      );
    });
  });

  describe('getOrder', () => {
    it("throws NotFoundException when the order does not exist or is outside the caller's visibility", async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.getOrder(clientUser, 'missing-id'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns OrderResponseDto for a client, OrderAdminResponseDto for a manager', async () => {
      prisma.order.findFirst.mockResolvedValue(orderEntity);

      const clientResult = await service.getOrder(clientUser, orderEntity.id);
      const managerResult = await service.getOrder(managerUser, orderEntity.id);

      expect(clientResult).not.toHaveProperty('user');
      expect(clientResult).not.toHaveProperty('promoCode');
      expect(managerResult).toHaveProperty('user', orderEntity.user);
      expect(managerResult).toHaveProperty('promoCode', orderEntity.promoCode);
    });
  });

  describe('cancelOrder', () => {
    it('releases reserved stock when cancelling a pending order', async () => {
      prisma.order.updateMany.mockResolvedValueOnce({ count: 1 }); // pending guard succeeds
      prisma.orderItem.findMany.mockResolvedValue([
        { skuId: skuA.id, quantity: 2 },
      ]);
      prisma.order.findUniqueOrThrow
        .mockResolvedValueOnce({ ...orderEntity, promoCodeId: null }) // post-cancel read for promo check
        .mockResolvedValueOnce(orderEntity); // final read with ORDER_INCLUDE

      const result = await service.cancelOrder(clientUser, orderEntity.id);

      expect(prisma.sku.update).toHaveBeenCalledWith({
        where: { id: skuA.id },
        data: { reservedStock: { decrement: 2 } },
      });
      expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith({
        data: {
          orderId: orderEntity.id,
          status: OrderStatus.cancelled,
          changedBy: clientUser.id,
        },
      });
      expect(result).not.toHaveProperty('user');
    });

    it('restocks (not releases) when cancelling a paid/processing order — the pending guard must have failed first', async () => {
      prisma.order.updateMany
        .mockResolvedValueOnce({ count: 0 }) // pending guard: not pending
        .mockResolvedValueOnce({ count: 1 }); // paid/processing guard: succeeds
      prisma.orderItem.findMany.mockResolvedValue([
        { skuId: skuA.id, quantity: 2 },
      ]);
      prisma.order.findUniqueOrThrow
        .mockResolvedValueOnce({ ...orderEntity, promoCodeId: null })
        .mockResolvedValueOnce(orderEntity);

      await service.cancelOrder(clientUser, orderEntity.id);

      expect(prisma.sku.update).toHaveBeenCalledWith({
        where: { id: skuA.id },
        data: { stock: { increment: 2 } },
      });
    });

    it('releases the promo redemption slot when the cancelled order had one', async () => {
      prisma.order.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.orderItem.findMany.mockResolvedValue([]);
      prisma.order.findUniqueOrThrow
        .mockResolvedValueOnce({ ...orderEntity, promoCodeId: activePromo.id })
        .mockResolvedValueOnce(orderEntity);

      await service.cancelOrder(clientUser, orderEntity.id);

      expect(prisma.promoCode.update).toHaveBeenCalledWith({
        where: { id: activePromo.id },
        data: { timesRedeemed: { decrement: 1 } },
      });
    });

    it('throws InvalidStatusTransitionException when the order is shipped, delivered, or already cancelled', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      prisma.order.findFirst.mockResolvedValue({
        ...orderEntity,
        status: OrderStatus.shipped,
      });

      await expect(
        service.cancelOrder(clientUser, orderEntity.id),
      ).rejects.toBeInstanceOf(InvalidStatusTransitionException);
    });

    it("throws NotFoundException, not a transition error, for another client's order (404-vs-403 ownership rule)", async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      prisma.order.findFirst.mockResolvedValue(null); // ownershipWhere excludes it

      await expect(
        service.cancelOrder(clientUser, orderEntity.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets a manager cancel any order regardless of owner', async () => {
      prisma.order.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.orderItem.findMany.mockResolvedValue([]);
      prisma.order.findUniqueOrThrow
        .mockResolvedValueOnce({ ...orderEntity, promoCodeId: null })
        .mockResolvedValueOnce(orderEntity);

      await service.cancelOrder(managerUser, orderEntity.id);

      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: orderEntity.id, status: OrderStatus.pending },
        data: { status: OrderStatus.cancelled },
      });
    });
  });

  describe('processOrder / shipOrder / deliverOrder', () => {
    it('processOrder: paid -> processing on success', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        ...orderEntity,
        status: OrderStatus.processing,
      });

      const result = await service.processOrder(managerUser, orderEntity.id);

      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: orderEntity.id, status: OrderStatus.paid },
        data: { status: OrderStatus.processing },
      });
      expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith({
        data: {
          orderId: orderEntity.id,
          status: OrderStatus.processing,
          changedBy: managerUser.id,
        },
      });
      expect(result.status).toBe(OrderStatus.processing);
    });

    it('processOrder: throws InvalidStatusTransitionException from any other status', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      prisma.order.findUnique.mockResolvedValue({
        ...orderEntity,
        status: OrderStatus.pending,
      });

      await expect(
        service.processOrder(managerUser, orderEntity.id),
      ).rejects.toBeInstanceOf(InvalidStatusTransitionException);
    });

    it('shipOrder: processing -> shipped on success', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        ...orderEntity,
        status: OrderStatus.shipped,
      });

      await service.shipOrder(managerUser, orderEntity.id);

      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: orderEntity.id, status: OrderStatus.processing },
        data: { status: OrderStatus.shipped },
      });
    });

    it('deliverOrder: shipped -> delivered on success, changedBy is the delivery person', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        ...orderEntity,
        status: OrderStatus.delivered,
      });

      const result = await service.deliverOrder(deliveryUser, orderEntity.id);

      expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith({
        data: {
          orderId: orderEntity.id,
          status: OrderStatus.delivered,
          changedBy: deliveryUser.id,
        },
      });
      expect(result).not.toHaveProperty('user');
    });

    it('throws NotFoundException, not a transition error, when the order does not exist at all', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.shipOrder(managerUser, 'missing-id'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listOrderStatusHistory', () => {
    it("throws NotFoundException when the order is outside the caller's visibility", async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.listOrderStatusHistory(clientUser, 'missing-id', {
          limit: 20,
          offset: 0,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns rows oldest-first with pagination meta', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: orderEntity.id });
      prisma.orderStatusHistory.findMany.mockResolvedValue([
        {
          id: 'h1',
          status: OrderStatus.pending,
          changedBy: null,
          createdAt: new Date(),
        },
      ]);
      prisma.orderStatusHistory.count.mockResolvedValue(1);

      const result = await service.listOrderStatusHistory(
        clientUser,
        orderEntity.id,
        {
          limit: 20,
          offset: 0,
        },
      );

      expect(prisma.orderStatusHistory.findMany).toHaveBeenCalledWith({
        where: { orderId: orderEntity.id },
        orderBy: { createdAt: 'asc' },
        skip: 0,
        take: 20,
      });
      expect(result.meta).toEqual({ total: 1, limit: 20, offset: 0 });
      expect(result.data[0].status).toBe(OrderStatus.pending);
    });
  });
});
