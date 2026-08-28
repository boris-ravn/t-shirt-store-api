// `service`, `activeProduct`, and `managerUser`/`clientUser` below are
// scaffolding for the it.todo cases — unused until those assertions are
// written in, not dead code.
/* eslint-disable @typescript-eslint/no-unused-vars */
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
  let imageUrlService: ImageUrlService;

  const managerUser = { id: 'manager-1', role: 'manager' as const };
  const clientUser = { id: 'client-1', role: 'client' as const };

  // A product row shaped like Prisma's findUnique/findMany result with
  // { include: { images: true, skus: true } } — active, not deleted.
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
    imageUrlService = module.get(ImageUrlService);
  });

  describe('list', () => {
    it.todo(
      'throws ForbiddenException when a non-manager passes the `status` filter',
    );

    it.todo(
      "scopes a client/anonymous caller's query to status: active, deletedAt: null",
    );

    it.todo(
      "lets a manager's query see all non-deleted statuses, optionally narrowed by `status`",
    );

    it.todo(
      'returns Product (not ProductAdmin) shaped items for a client/anonymous caller',
    );

    it.todo(
      'returns ProductAdmin shaped items — with skuCode/stock/reservedStock — for a manager',
    );

    it.todo(
      'uses sku.groupBy + a hydration query, not product.findMany.orderBy, when sort is price/-price',
    );
  });

  describe('getById', () => {
    it.todo('throws NotFoundException when the product does not exist');

    it.todo(
      'throws NotFoundException when the product is soft-deleted, even for a manager',
    );

    it.todo(
      'throws NotFoundException for a disabled product when the caller is not a manager',
    );

    it.todo('returns the product for a manager even when disabled');
  });

  describe('create', () => {
    it.todo(
      'throws NotFoundException when categoryId does not reference an existing category',
    );

    it.todo('creates the product and returns it as ProductAdminResponseDto');
  });

  describe('update', () => {
    it.todo('throws NotFoundException when the product does not exist');

    it.todo(
      'throws NotFoundException when categoryId is provided but does not exist',
    );

    it.todo(
      'writing `status` is the only way to disable/enable — verify it round-trips',
    );
  });

  describe('delete', () => {
    it.todo(
      'throws NotFoundException when the product does not exist or is already deleted (idempotent)',
    );

    it.todo('sets deletedAt rather than removing the row');
  });
});
