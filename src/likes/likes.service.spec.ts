import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProductStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { ImageUrlService } from '../storage/image-url.service';
import { LikesService } from './likes.service';

describe('LikesService', () => {
  let service: LikesService;
  let prisma: {
    product: { findUnique: jest.Mock };
    like: {
      upsert: jest.Mock;
      deleteMany: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let imageUrlService: { buildUrl: jest.Mock };

  const userId = 'user-1';
  const productId = 'product-1';

  const activeProduct = {
    id: productId,
    categoryId: 'category-1',
    name: 'Classic Tee',
    description: null,
    status: ProductStatus.active,
    deletedAt: null,
    images: [{ s3Key: 'products/classic-tee/front.jpg' }],
    skus: [],
  };

  const likeFixture = {
    id: 'like-1',
    userId,
    productId,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    product: activeProduct,
  };

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn() },
      like: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    imageUrlService = {
      buildUrl: jest.fn((s3Key: string) => `https://cdn.example/${s3Key}`),
    };

    const module = await Test.createTestingModule({
      providers: [
        LikesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ImageUrlService, useValue: imageUrlService },
      ],
    }).compile();

    service = module.get(LikesService);
  });

  describe('like', () => {
    it('throws NotFoundException when the product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.like(userId, productId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.like.upsert).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the product is soft-deleted', async () => {
      prisma.product.findUnique.mockResolvedValue({
        ...activeProduct,
        deletedAt: new Date(),
      });

      await expect(service.like(userId, productId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the product is disabled', async () => {
      prisma.product.findUnique.mockResolvedValue({
        ...activeProduct,
        status: ProductStatus.disabled,
      });

      await expect(service.like(userId, productId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('upserts the like, idempotent on a repeat call', async () => {
      prisma.product.findUnique.mockResolvedValue(activeProduct);
      prisma.like.upsert.mockResolvedValue(likeFixture);

      await service.like(userId, productId);

      expect(prisma.like.upsert).toHaveBeenCalledWith({
        where: { userId_productId: { userId, productId } },
        create: { userId, productId },
        update: {},
      });
    });
  });

  describe('unlike', () => {
    it('throws NotFoundException when the product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.unlike(userId, productId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.like.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes the like (deleteMany, so a missing like is a no-op, not an error)', async () => {
      prisma.product.findUnique.mockResolvedValue(activeProduct);
      prisma.like.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.unlike(userId, productId)).resolves.toBeUndefined();
      expect(prisma.like.deleteMany).toHaveBeenCalledWith({
        where: { userId, productId },
      });
    });

    it('succeeds on a disabled product, unlike like() — a disable must not strand an existing like', async () => {
      prisma.product.findUnique.mockResolvedValue({
        ...activeProduct,
        status: ProductStatus.disabled,
      });
      prisma.like.deleteMany.mockResolvedValue({ count: 1 });

      await expect(service.unlike(userId, productId)).resolves.toBeUndefined();
      expect(prisma.like.deleteMany).toHaveBeenCalledWith({
        where: { userId, productId },
      });
    });
  });

  describe('listLikedProducts', () => {
    const query = { limit: 20, offset: 0 };

    it('returns liked products, most recently liked first', async () => {
      prisma.like.findMany.mockResolvedValue([likeFixture]);
      prisma.like.count.mockResolvedValue(1);

      const result = await service.listLikedProducts(userId, query);

      expect(prisma.like.findMany).toHaveBeenCalledWith({
        where: {
          userId,
          product: { deletedAt: null, status: ProductStatus.active },
        },
        include: {
          product: {
            include: {
              images: { orderBy: { position: 'asc' } },
              skus: { where: { deletedAt: null } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.offset,
        take: query.limit,
      });
      expect(result.data).toHaveLength(1);
      // The product, not the like row — likeFixture.id ('like-1') must not
      // leak into the response.
      expect(result.data[0].id).toBe(activeProduct.id);
      expect(result.data[0].name).toBe(activeProduct.name);
      expect(result.data[0].images[0].url).toBe(
        `https://cdn.example/${activeProduct.images[0].s3Key}`,
      );
      expect(result.meta).toEqual({
        total: 1,
        limit: query.limit,
        offset: query.offset,
      });
    });

    it('excludes products that became disabled or soft-deleted after being liked', async () => {
      prisma.like.findMany.mockResolvedValue([]);
      prisma.like.count.mockResolvedValue(0);

      const result = await service.listLikedProducts(userId, query);

      expect(prisma.like.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId,
            product: { deletedAt: null, status: ProductStatus.active },
          },
        }),
      );
      expect(result.data).toEqual([]);
      expect(result.meta).toEqual({
        total: 0,
        limit: query.limit,
        offset: query.offset,
      });
    });
  });
});
