// `service` and `activeSku` below are scaffolding for the it.todo cases —
// unused until those assertions are written in, not dead code.
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test } from '@nestjs/testing';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SkusService } from './skus.service';

describe('SkusService', () => {
  let service: SkusService;
  let prisma: {
    product: { findUnique: jest.Mock };
    sku: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
  };

  const activeSku = {
    id: 'sku-1',
    productId: 'product-1',
    skuCode: 'TEE-BLK-M',
    size: 'M',
    color: 'black',
    price: 1999,
    stock: 50,
    reservedStock: 0,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  // Real PrismaClientKnownRequestError instances, meta shaped like
  // @prisma/adapter-pg's actual P2002 (not the classic meta.target
  // string[] — see prisma-error.util.ts's own comment on why). Use as
  // prisma.sku.create.mockRejectedValue(skuCodeConflict / sizeColorConflict).
  const skuCodeConflict = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    {
      code: 'P2002',
      clientVersion: '7.10.0',
      meta: {
        driverAdapterError: {
          cause: { constraint: { index: 'skus_sku_code_key' } },
        },
      },
    },
  );
  const sizeColorConflict = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    {
      code: 'P2002',
      clientVersion: '7.10.0',
      meta: {
        driverAdapterError: {
          cause: { constraint: { index: 'skus_product_id_size_color_key' } },
        },
      },
    },
  );

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn() },
      sku: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [SkusService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(SkusService);
  });

  describe('create', () => {
    it.todo(
      'throws NotFoundException when productId does not reference an existing product',
    );

    it.todo(
      "throws DuplicateSkuException('skuCode') on the skus_sku_code_key constraint",
    );

    it.todo(
      "throws DuplicateSkuException('size,color') on the skus_product_id_size_color_key constraint",
    );

    it.todo('creates and returns the SKU on success');
  });

  describe('update', () => {
    it.todo(
      'throws NotFoundException when the SKU does not exist or is soft-deleted',
    );

    it.todo(
      'throws DuplicateSkuException on either unique constraint, distinguished by index name',
    );
  });

  describe('delete', () => {
    it.todo(
      'throws NotFoundException when the SKU does not exist or is already deleted (idempotent)',
    );

    it.todo(
      'throws SkuReservedException with the real reservedStock when reservedStock > 0',
    );

    it.todo('soft-deletes (sets deletedAt) when reservedStock is 0');
  });

  describe('restock', () => {
    it.todo(
      'throws NotFoundException when the SKU does not exist or is soft-deleted',
    );

    it.todo('increments stock by quantity (a delta, not an absolute value)');
  });
});
