import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ImageUrlService } from '../storage/image-url.service';
import { CartService } from './cart.service';

// Same shape as the P2002 fixtures in skus.service.spec.ts — a real
// PrismaClientKnownRequestError, not a plain object, since isUniqueConstraintViolation/
// isRecordNotFound check `instanceof`.
const cartUserIdConflict = new Prisma.PrismaClientKnownRequestError(
  'Unique constraint failed',
  {
    code: 'P2002',
    clientVersion: '7.10.0',
    meta: {
      driverAdapterError: {
        cause: { constraint: { index: 'carts_user_id_key' } },
      },
    },
  },
);

const recordNotFoundError = new Prisma.PrismaClientKnownRequestError(
  'An operation failed because it depends on one or more records that were required but not found.',
  { code: 'P2025', clientVersion: '7.10.0' },
);

describe('CartService', () => {
  let service: CartService;
  let prisma: {
    cart: {
      findUnique: jest.Mock;
      create: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    cartItem: {
      upsert: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
      findUnique: jest.Mock;
    };
    sku: { findUnique: jest.Mock };
  };
  let imageUrlService: { buildUrl: jest.Mock };

  const userId = 'user-1';
  const cartId = 'cart-1';

  const activeSku = {
    id: 'sku-1',
    size: 'M',
    color: 'black',
    price: 1999,
    stock: 50,
    reservedStock: 5,
    deletedAt: null,
    product: {
      id: 'product-1',
      name: 'Classic Tee',
      deletedAt: null,
      images: [{ s3Key: 'products/classic-tee/front.jpg' }],
    },
  };

  const cartItemFixture = {
    id: 'cart-item-1',
    quantity: 2,
    sku: activeSku,
  };

  const emptyCart = {
    id: cartId,
    userId,
    items: [] as (typeof cartItemFixture)[],
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  const cartWithItem = {
    ...emptyCart,
    items: [cartItemFixture],
  };

  beforeEach(async () => {
    prisma = {
      cart: {
        findUnique: jest.fn(),
        create: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      cartItem: {
        upsert: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        findUnique: jest.fn(),
      },
      sku: { findUnique: jest.fn() },
    };
    imageUrlService = {
      buildUrl: jest.fn((s3Key: string) => `https://cdn.example/${s3Key}`),
    };

    const module = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: PrismaService, useValue: prisma },
        { provide: ImageUrlService, useValue: imageUrlService },
      ],
    }).compile();

    service = module.get(CartService);
  });

  describe('getOrCreate', () => {
    it('creates an empty cart on first read and returns it', async () => {
      prisma.cart.findUnique.mockResolvedValue(null);
      prisma.cart.create.mockResolvedValue(emptyCart);

      const result = await service.getOrCreate(userId);

      expect(prisma.cart.create).toHaveBeenCalledWith({
        data: { userId },
        include: {
          items: {
            orderBy: { createdAt: 'asc' },
            include: {
              sku: {
                include: {
                  product: {
                    include: {
                      images: { orderBy: { position: 'asc' }, take: 1 },
                    },
                  },
                },
              },
            },
          },
        },
      });
      expect(result.id).toBe(cartId);
      expect(result.items).toEqual([]);
      expect(result.subtotal).toEqual({ amount: 0, currency: 'USD' });
    });

    it('returns the existing cart without creating a new one', async () => {
      prisma.cart.findUnique.mockResolvedValue(cartWithItem);

      const result = await service.getOrCreate(userId);

      expect(prisma.cart.create).not.toHaveBeenCalled();
      expect(result.items).toHaveLength(1);
      const expectedLineTotal = {
        amount: activeSku.price * cartItemFixture.quantity,
        currency: 'USD',
      };
      expect(result.subtotal).toEqual(expectedLineTotal);
      const [item] = result.items;
      expect(item.lineTotal).toEqual(expectedLineTotal);
      expect(item.availableQuantity).toBe(
        activeSku.stock - activeSku.reservedStock,
      );
      expect(item.sku.price).toEqual({
        amount: activeSku.price,
        currency: 'USD',
      });
      expect(item.sku.availableQuantity).toBe(
        activeSku.stock - activeSku.reservedStock,
      );
      expect(item.product.imageUrl).toBe(
        `https://cdn.example/${activeSku.product.images[0].s3Key}`,
      );
      expect(imageUrlService.buildUrl).toHaveBeenCalledWith(
        activeSku.product.images[0].s3Key,
      );
    });

    it('recovers when cart creation loses a race on the unique userId', async () => {
      prisma.cart.findUnique.mockResolvedValue(null);
      prisma.cart.create.mockRejectedValue(cartUserIdConflict);
      prisma.cart.findUniqueOrThrow.mockResolvedValue(emptyCart);

      const result = await service.getOrCreate(userId);

      expect(prisma.cart.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { userId },
        include: {
          items: {
            orderBy: { createdAt: 'asc' },
            include: {
              sku: {
                include: {
                  product: {
                    include: {
                      images: { orderBy: { position: 'asc' }, take: 1 },
                    },
                  },
                },
              },
            },
          },
        },
      });
      expect(result.id).toBe(cartId);
      expect(result.items).toEqual([]);
    });
  });

  describe('addItem', () => {
    const dto = { skuId: activeSku.id, quantity: 1 };

    it('throws NotFoundException when the SKU does not exist', async () => {
      prisma.cart.findUnique.mockResolvedValue(cartWithItem);
      prisma.sku.findUnique.mockResolvedValue(null);

      await expect(service.addItem(userId, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the SKU is soft-deleted', async () => {
      prisma.cart.findUnique.mockResolvedValue(cartWithItem);
      prisma.sku.findUnique.mockResolvedValue({
        ...activeSku,
        deletedAt: new Date(),
      });

      await expect(service.addItem(userId, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the SKU is active but its parent product is soft-deleted', async () => {
      prisma.cart.findUnique.mockResolvedValue(cartWithItem);
      prisma.sku.findUnique.mockResolvedValue({
        ...activeSku,
        product: { ...activeSku.product, deletedAt: new Date() },
      });

      await expect(service.addItem(userId, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('upserts the cart item (increment on an existing line) and returns the refreshed cart', async () => {
      prisma.cart.findUnique.mockResolvedValue(cartWithItem);
      prisma.sku.findUnique.mockResolvedValue(activeSku);
      prisma.cartItem.upsert.mockResolvedValue(cartItemFixture);

      const result = await service.addItem(userId, dto);

      expect(prisma.cartItem.upsert).toHaveBeenCalledWith({
        where: { cartId_skuId: { cartId: cartWithItem.id, skuId: dto.skuId } },
        create: {
          cartId: cartWithItem.id,
          skuId: dto.skuId,
          quantity: dto.quantity,
        },
        update: { quantity: { increment: dto.quantity } },
      });
      expect(result.items).toHaveLength(1);
    });
  });

  describe('updateItem', () => {
    it('throws NotFoundException when the item belongs to another user (ownership, not existence — decisions.md 404-vs-403 rule)', async () => {
      prisma.cartItem.findUnique.mockResolvedValue({
        ...cartItemFixture,
        cart: { userId: 'someone-else' },
      });

      await expect(
        service.updateItem(userId, cartItemFixture.id, { quantity: 3 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.cartItem.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the item does not exist', async () => {
      prisma.cartItem.findUnique.mockResolvedValue(null);

      await expect(
        service.updateItem(userId, 'missing-id', { quantity: 3 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('sets the quantity absolutely, not as a delta, and returns the refreshed cart', async () => {
      prisma.cartItem.findUnique.mockResolvedValue({
        ...cartItemFixture,
        cart: { userId },
      });
      prisma.cartItem.update.mockResolvedValue(cartItemFixture);
      prisma.cart.findUnique.mockResolvedValue(cartWithItem);

      const result = await service.updateItem(userId, cartItemFixture.id, {
        quantity: 3,
      });

      expect(prisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: cartItemFixture.id },
        data: { quantity: 3 },
      });
      expect(result.items).toHaveLength(1);
    });

    it('throws NotFoundException when the item was removed between the ownership check and the update (P2025)', async () => {
      prisma.cartItem.findUnique.mockResolvedValue({
        ...cartItemFixture,
        cart: { userId },
      });
      prisma.cartItem.update.mockRejectedValue(recordNotFoundError);

      await expect(
        service.updateItem(userId, cartItemFixture.id, { quantity: 3 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.cart.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('removeItem', () => {
    it('throws NotFoundException when the item belongs to another user', async () => {
      prisma.cartItem.findUnique.mockResolvedValue({
        ...cartItemFixture,
        cart: { userId: 'someone-else' },
      });

      await expect(
        service.removeItem(userId, cartItemFixture.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.cartItem.delete).not.toHaveBeenCalled();
    });

    it('deletes the item when it belongs to the caller', async () => {
      prisma.cartItem.findUnique.mockResolvedValue({
        ...cartItemFixture,
        cart: { userId },
      });

      await service.removeItem(userId, cartItemFixture.id);

      expect(prisma.cartItem.delete).toHaveBeenCalledWith({
        where: { id: cartItemFixture.id },
      });
    });

    it('throws NotFoundException when the item was already removed by a concurrent call (P2025)', async () => {
      prisma.cartItem.findUnique.mockResolvedValue({
        ...cartItemFixture,
        cart: { userId },
      });
      prisma.cartItem.delete.mockRejectedValue(recordNotFoundError);

      await expect(
        service.removeItem(userId, cartItemFixture.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('clear', () => {
    it("deletes every item on the caller's cart, leaving the cart row itself", async () => {
      prisma.cart.findUnique.mockResolvedValue(cartWithItem);

      await service.clear(userId);

      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: cartWithItem.id },
      });
      expect(prisma.cart.create).not.toHaveBeenCalled();
    });
  });
});
