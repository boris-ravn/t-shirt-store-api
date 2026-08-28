import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageUrlService } from '../../storage/image-url.service';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: {
    product: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    sku: { groupBy: jest.Mock };
    category: { findUnique: jest.Mock };
  };

  const managerUser = { id: 'manager-1', role: 'manager' as const };
  const clientUser = { id: 'client-1', role: 'client' as const };

  // The include shape products.service.ts actually asks Prisma for —
  // non-deleted SKUs only, images in position order.
  const EXPECTED_PRODUCT_INCLUDE = {
    images: { orderBy: { position: 'asc' } },
    skus: { where: { deletedAt: null } },
  };

  // A product row shaped like Prisma's findUnique/findMany result with
  // { include: EXPECTED_PRODUCT_INCLUDE } — active, not deleted.
  const activeProduct = {
    id: 'product-1',
    categoryId: 'category-1',
    name: 'Classic Tee',
    description: 'A cotton crewneck.',
    status: 'active' as const,
    deletedAt: null,
    images: [],
    skus: [
      {
        id: 'sku-1',
        productId: 'product-1',
        skuCode: 'TEE-BLK-M',
        size: 'M',
        color: 'black',
        price: 1999,
        stock: 50,
        reservedStock: 8,
        deletedAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    prisma = {
      product: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      sku: { groupBy: jest.fn() },
      category: { findUnique: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prisma },
        ImageUrlService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('irrelevant-for-these-tests'),
          },
        },
      ],
    }).compile();

    service = module.get(ProductsService);
  });

  const baseQuery = { limit: 20, offset: 0, sort: '-createdAt' as const };

  describe('list', () => {
    it('throws ForbiddenException when a non-manager passes the `status` filter', async () => {
      await expect(
        service.list({ ...baseQuery, status: 'active' as const }, clientUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.list({ ...baseQuery, status: 'active' as const }, null),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.product.count).not.toHaveBeenCalled();
    });

    it("scopes a client/anonymous caller's query to status: active, deletedAt: null", async () => {
      prisma.product.count.mockResolvedValue(1);
      prisma.product.findMany.mockResolvedValue([activeProduct]);

      await service.list(baseQuery, clientUser);

      expect(prisma.product.count).toHaveBeenCalledWith({
        where: { deletedAt: null, status: 'active' },
      });

      prisma.product.count.mockClear();
      await service.list(baseQuery, null);

      expect(prisma.product.count).toHaveBeenCalledWith({
        where: { deletedAt: null, status: 'active' },
      });
    });

    it("lets a manager's query see all non-deleted statuses, optionally narrowed by `status`", async () => {
      prisma.product.count.mockResolvedValue(1);
      prisma.product.findMany.mockResolvedValue([activeProduct]);

      await service.list(baseQuery, managerUser);

      expect(prisma.product.count).toHaveBeenCalledWith({
        where: { deletedAt: null },
      });

      prisma.product.count.mockClear();
      await service.list(
        { ...baseQuery, status: 'disabled' as const },
        managerUser,
      );

      expect(prisma.product.count).toHaveBeenCalledWith({
        where: { deletedAt: null, status: 'disabled' },
      });
    });

    it('returns Product (not ProductAdmin) shaped items for a client/anonymous caller', async () => {
      prisma.product.count.mockResolvedValue(1);
      prisma.product.findMany.mockResolvedValue([activeProduct]);

      const result = await service.list(baseQuery, clientUser);

      expect(result).toEqual({
        data: [
          {
            id: activeProduct.id,
            categoryId: activeProduct.categoryId,
            name: activeProduct.name,
            description: activeProduct.description,
            images: [],
            skus: [
              {
                id: 'sku-1',
                size: 'M',
                color: 'black',
                price: { amount: 1999, currency: 'USD' },
                availableQuantity: 42,
              },
            ],
            createdAt: activeProduct.createdAt,
            updatedAt: activeProduct.updatedAt,
          },
        ],
        meta: { total: 1, limit: 20, offset: 0 },
      });
    });

    it('returns ProductAdmin shaped items — with skuCode/stock/reservedStock — for a manager', async () => {
      prisma.product.count.mockResolvedValue(1);
      prisma.product.findMany.mockResolvedValue([activeProduct]);

      const result = await service.list(baseQuery, managerUser);

      expect(result).toEqual({
        data: [
          {
            id: activeProduct.id,
            categoryId: activeProduct.categoryId,
            name: activeProduct.name,
            description: activeProduct.description,
            status: 'active',
            images: [],
            skus: [
              {
                id: 'sku-1',
                size: 'M',
                color: 'black',
                price: { amount: 1999, currency: 'USD' },
                availableQuantity: 42,
                skuCode: 'TEE-BLK-M',
                stock: 50,
                reservedStock: 8,
                deletedAt: null,
              },
            ],
            createdAt: activeProduct.createdAt,
            updatedAt: activeProduct.updatedAt,
          },
        ],
        meta: { total: 1, limit: 20, offset: 0 },
      });
    });

    it.todo(
      'excludes soft-deleted SKUs from every response (the skus include is scoped to deletedAt: null, for both client and manager shapes)',
    );

    it('uses sku.groupBy + a hydration query, not product.findMany.orderBy, when sort is price/-price', async () => {
      prisma.product.count.mockResolvedValue(1);
      prisma.sku.groupBy.mockResolvedValue([{ productId: 'product-1' }]);
      prisma.product.findMany.mockResolvedValue([activeProduct]);

      await service.list({ ...baseQuery, sort: 'price' as const }, clientUser);

      expect(prisma.sku.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['productId'],
          _min: { price: true },
          orderBy: [{ _min: { price: 'asc' } }, { productId: 'asc' }],
          skip: 0,
          take: 20,
        }),
      );
      expect(prisma.product.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['product-1'] } },
        include: EXPECTED_PRODUCT_INCLUDE,
      });
    });

    it.todo(
      "computes `total` from a query that also requires >=1 non-deleted SKU when sort is price/-price, so it can't exceed what's actually reachable through that sort mode",
    );

    // findProductsPage re-sorts the hydrated rows to match the groupBy
    // order explicitly (via the ids.map(...).filter(...) pass) rather than
    // trusting findMany({ id: { in: ids } }) to preserve it — Postgres gives
    // no such guarantee for an IN-list query.
    it('preserves the sku.groupBy price order after hydration, even when findMany returns rows in a different order', async () => {
      const productA = { ...activeProduct, id: 'product-a' };
      const productB = { ...activeProduct, id: 'product-b' };
      const productC = { ...activeProduct, id: 'product-c' };

      prisma.product.count.mockResolvedValue(3);
      prisma.sku.groupBy.mockResolvedValue([
        { productId: 'product-b' },
        { productId: 'product-c' },
        { productId: 'product-a' },
      ]);
      // Deliberately out of groupBy order, as an unordered IN-list result would be.
      prisma.product.findMany.mockResolvedValue([productA, productC, productB]);

      const result = await service.list(
        { ...baseQuery, sort: '-price' as const },
        managerUser,
      );

      expect(result.data.map((product) => product.id)).toEqual([
        'product-b',
        'product-c',
        'product-a',
      ]);
    });
  });

  describe('getById', () => {
    it('throws NotFoundException when the product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.getById('missing-id', managerUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the product is soft-deleted, even for a manager', async () => {
      prisma.product.findUnique.mockResolvedValue({
        ...activeProduct,
        deletedAt: new Date('2026-02-01T00:00:00Z'),
      });

      await expect(
        service.getById(activeProduct.id, managerUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for a disabled product when the caller is not a manager', async () => {
      prisma.product.findUnique.mockResolvedValue({
        ...activeProduct,
        status: 'disabled',
      });

      await expect(
        service.getById(activeProduct.id, clientUser),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.getById(activeProduct.id, null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the product for a manager even when disabled', async () => {
      prisma.product.findUnique.mockResolvedValue({
        ...activeProduct,
        status: 'disabled',
      });

      const result = await service.getById(activeProduct.id, managerUser);

      expect(result).toEqual(
        expect.objectContaining({ id: activeProduct.id, status: 'disabled' }),
      );
    });
  });

  describe('create', () => {
    it('throws NotFoundException when categoryId does not reference an existing category', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ categoryId: 'missing-category', name: 'Tee' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('creates the product and returns it as ProductAdminResponseDto', async () => {
      prisma.category.findUnique.mockResolvedValue({ id: 'category-1' });
      prisma.product.create.mockResolvedValue(activeProduct);

      const result = await service.create({
        categoryId: 'category-1',
        name: 'Classic Tee',
        description: 'A cotton crewneck.',
      });

      expect(prisma.product.create).toHaveBeenCalledWith({
        data: {
          categoryId: 'category-1',
          name: 'Classic Tee',
          description: 'A cotton crewneck.',
        },
        include: EXPECTED_PRODUCT_INCLUDE,
      });
      expect(result).toEqual(
        expect.objectContaining({ id: activeProduct.id, status: 'active' }),
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { name: 'New Name' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when categoryId is provided but does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(activeProduct);
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.update(activeProduct.id, { categoryId: 'missing-category' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('writing `status` is the only way to disable/enable — verify it round-trips', async () => {
      prisma.product.findUnique.mockResolvedValue(activeProduct);
      prisma.product.update.mockResolvedValue({
        ...activeProduct,
        status: 'disabled',
      });

      const result = await service.update(activeProduct.id, {
        status: 'disabled' as const,
      });

      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: activeProduct.id },
        data: {
          name: undefined,
          description: undefined,
          categoryId: undefined,
          status: 'disabled',
        },
        include: EXPECTED_PRODUCT_INCLUDE,
      });
      expect(result.status).toBe('disabled');
    });
  });

  describe('delete', () => {
    it('throws NotFoundException when the product does not exist or is already deleted (idempotent)', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.delete('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prisma.product.findUnique.mockResolvedValue({
        ...activeProduct,
        deletedAt: new Date('2026-02-01T00:00:00Z'),
      });

      await expect(service.delete(activeProduct.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('sets deletedAt rather than removing the row', async () => {
      prisma.product.findUnique.mockResolvedValue(activeProduct);
      prisma.product.update.mockResolvedValue({
        ...activeProduct,
        deletedAt: new Date('2026-02-01T00:00:00Z'),
      });

      await service.delete(activeProduct.id);

      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: activeProduct.id },
        data: { deletedAt: expect.any(Date) as Date },
      });
    });
  });
});
