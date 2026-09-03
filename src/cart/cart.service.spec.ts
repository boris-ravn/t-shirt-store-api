import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ImageUrlService } from '../storage/image-url.service';
import { CartService } from './cart.service';

// Scaffolded per this repo's testing-agent workflow (IMPLEMENTATION_PLAN.md,
// Slice 1): fixtures and mocks are wired up and each behavior is named as
// its own test, but assertion bodies are left as TODOs for the dedicated
// testing pass rather than written by the same session that wrote the
// service — see the root CLAUDE.md's rule on this.
describe('CartService', () => {
  let service: CartService;
  let prisma: {
    cart: { findUnique: jest.Mock; create: jest.Mock };
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
      cart: { findUnique: jest.fn(), create: jest.fn() },
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

      // TODO(testing agent): assert prisma.cart.create was called with
      // { data: { userId }, include: <CART_INCLUDE shape> }, and that the
      // returned CartResponseDto has items: [] and subtotal 0 USD.
      void result;
    });

    it('returns the existing cart without creating a new one', async () => {
      prisma.cart.findUnique.mockResolvedValue(cartWithItem);

      const result = await service.getOrCreate(userId);

      // TODO(testing agent): assert prisma.cart.create was NOT called, and
      // the returned DTO's items/subtotal/product.imageUrl are derived
      // correctly from cartWithItem's fixture (subtotal = 1999 * 2, product
      // imageUrl built via imageUrlService.buildUrl(s3Key)).
      void result;
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
      // TODO(testing agent): assert prisma.cartItem.upsert was NOT called.
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

      // TODO(testing agent): assert prisma.cartItem.upsert was called with
      // where: { cartId_skuId: { cartId: cartWithItem.id, skuId: dto.skuId } },
      // create: { cartId, skuId, quantity: dto.quantity },
      // update: { quantity: { increment: dto.quantity } } — this is the one
      // Prisma compound-key shape to double-check against the generated
      // client (src/generated/prisma/models/CartItem.ts) rather than assume.
      void result;
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
      // TODO(testing agent): assert prisma.cartItem.update was NOT called.
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

      // TODO(testing agent): assert prisma.cartItem.update was called with
      // { where: { id: cartItemFixture.id }, data: { quantity: 3 } } —
      // absolute, matching UpdateCartItemRequestDto's contract, no increment.
      void result;
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
      // TODO(testing agent): assert prisma.cartItem.delete was NOT called.
    });

    it('deletes the item when it belongs to the caller', async () => {
      prisma.cartItem.findUnique.mockResolvedValue({
        ...cartItemFixture,
        cart: { userId },
      });

      await service.removeItem(userId, cartItemFixture.id);

      // TODO(testing agent): assert prisma.cartItem.delete was called with
      // { where: { id: cartItemFixture.id } }.
    });
  });

  describe('clear', () => {
    it("deletes every item on the caller's cart, leaving the cart row itself", async () => {
      prisma.cart.findUnique.mockResolvedValue(cartWithItem);

      await service.clear(userId);

      // TODO(testing agent): assert prisma.cartItem.deleteMany was called
      // with { where: { cartId: cartWithItem.id } }, and that no method on
      // prisma.cart itself (beyond the lookup) was ever called — the cart
      // row survives, only its items are removed.
    });
  });
});
