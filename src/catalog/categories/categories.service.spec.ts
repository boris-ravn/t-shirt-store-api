import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from './categories.service';
import { CategoryNameTakenException } from './exceptions/category-name-taken.exception';
import { CategoryNotEmptyException } from './exceptions/category-not-empty.exception';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: {
    category: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const existingCategory = {
    id: 'category-1',
    name: 'T-Shirts',
    slug: 't-shirts',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  // A real PrismaClientKnownRequestError (not a plain Error with .code
  // bolted on) — isUniqueConstraintViolation checks `instanceof`, so it
  // must be the actual class. Meta shape matches what @prisma/adapter-pg's
  // P2002 actually carries (see prisma-error.util.ts), though
  // CategoriesService doesn't inspect meta at all — this only matters for
  // accuracy.
  const uniqueConstraintError = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    {
      code: 'P2002',
      clientVersion: '7.10.0',
      meta: {
        driverAdapterError: {
          cause: { constraint: { index: 'categories_name_key' } },
        },
      },
    },
  );

  beforeEach(async () => {
    prisma = {
      category: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CategoriesService);
  });

  describe('list', () => {
    it('returns data mapped through CategoryResponseDto and meta from limit/offset/count', async () => {
      const otherCategory = {
        ...existingCategory,
        id: 'category-2',
        name: 'Hoodies',
        slug: 'hoodies',
      };
      prisma.category.findMany.mockResolvedValue([
        existingCategory,
        otherCategory,
      ]);
      prisma.category.count.mockResolvedValue(2);

      const result = await service.list({ limit: 20, offset: 0 });

      expect(prisma.category.findMany).toHaveBeenCalledWith({
        take: 20,
        skip: 0,
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual({
        data: [existingCategory, otherCategory].map((category) => ({
          id: category.id,
          name: category.name,
          slug: category.slug,
          createdAt: category.createdAt,
          updatedAt: category.updatedAt,
        })),
        meta: { total: 2, limit: 20, offset: 0 },
      });
    });
  });

  describe('getById', () => {
    it('throws NotFoundException when no category has that id', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(service.getById('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the category when found', async () => {
      prisma.category.findUnique.mockResolvedValue(existingCategory);

      const result = await service.getById(existingCategory.id);

      expect(prisma.category.findUnique).toHaveBeenCalledWith({
        where: { id: existingCategory.id },
      });
      expect(result).toEqual({
        id: existingCategory.id,
        name: existingCategory.name,
        slug: existingCategory.slug,
        createdAt: existingCategory.createdAt,
        updatedAt: existingCategory.updatedAt,
      });
    });
  });

  describe('create', () => {
    it('throws CategoryNameTakenException on a P2002 violation instead of the raw Prisma error', async () => {
      prisma.category.create.mockRejectedValue(uniqueConstraintError);

      await expect(
        service.create({ name: 'T-Shirts', slug: 't-shirts' }),
      ).rejects.toBeInstanceOf(CategoryNameTakenException);
    });

    it('creates and returns the category on success', async () => {
      prisma.category.create.mockResolvedValue(existingCategory);

      const result = await service.create({
        name: existingCategory.name,
        slug: existingCategory.slug,
      });

      expect(prisma.category.create).toHaveBeenCalledWith({
        data: { name: existingCategory.name, slug: existingCategory.slug },
      });
      expect(result).toEqual({
        id: existingCategory.id,
        name: existingCategory.name,
        slug: existingCategory.slug,
        createdAt: existingCategory.createdAt,
        updatedAt: existingCategory.updatedAt,
      });
    });
  });

  describe('update', () => {
    it('throws NotFoundException when no category has that id (via the getById precheck)', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { name: 'New Name' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('throws CategoryNameTakenException on a P2002 violation', async () => {
      prisma.category.findUnique.mockResolvedValue(existingCategory);
      prisma.category.update.mockRejectedValue(uniqueConstraintError);

      await expect(
        service.update(existingCategory.id, { name: 'Hoodies' }),
      ).rejects.toBeInstanceOf(CategoryNameTakenException);
    });
  });

  describe('delete', () => {
    it('throws NotFoundException when no category has that id', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(service.delete('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('throws CategoryNotEmptyException with the real productCount when products reference it', async () => {
      prisma.category.findUnique.mockResolvedValue({
        ...existingCategory,
        _count: { products: 3 },
      });

      const error = await service
        .delete(existingCategory.id)
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(CategoryNotEmptyException);
      expect((error as CategoryNotEmptyException).getResponse()).toEqual(
        expect.objectContaining({ productCount: 3 }),
      );
      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('deletes the category when it has no products', async () => {
      prisma.category.findUnique.mockResolvedValue({
        ...existingCategory,
        _count: { products: 0 },
      });

      await service.delete(existingCategory.id);

      expect(prisma.category.delete).toHaveBeenCalledWith({
        where: { id: existingCategory.id },
      });
    });
  });
});
