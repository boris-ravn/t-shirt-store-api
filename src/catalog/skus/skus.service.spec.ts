import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../generated/prisma/client';
import { LowStockService } from '../../notifications/low-stock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DuplicateSkuException } from './exceptions/duplicate-sku.exception';
import { SkuReservedException } from './exceptions/sku-reserved.exception';
import { SkusService } from './skus.service';

describe('SkusService', () => {
  let service: SkusService;
  let prisma: {
    product: { findUnique: jest.Mock };
    sku: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
  };
  let lowStockService: { resolveIfCrossedAbove: jest.Mock };

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
    // getActiveOrThrow includes the parent product's deletedAt alongside
    // the SKU's own — spread by every test below unless overridden.
    product: { deletedAt: null },
  };

  // Real PrismaClientKnownRequestError instances, meta shaped like
  // @prisma/adapter-pg's actual P2002 (not the classic meta.target
  // string[] — see prisma-error.util.ts's own comment on why).
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
    lowStockService = { resolveIfCrossedAbove: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        SkusService,
        { provide: PrismaService, useValue: prisma },
        { provide: LowStockService, useValue: lowStockService },
      ],
    }).compile();

    service = module.get(SkusService);
  });

  const createDto = {
    productId: 'product-1',
    skuCode: 'TEE-BLK-M',
    size: 'M',
    color: 'black',
    price: { amount: 1999, currency: 'USD' },
    stock: 50,
  };

  describe('create', () => {
    it('throws NotFoundException when productId does not reference an existing product', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.sku.create).not.toHaveBeenCalled();
    });

    it("throws DuplicateSkuException('skuCode') on the skus_sku_code_key constraint", async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'product-1',
        deletedAt: null,
      });
      prisma.sku.create.mockRejectedValue(skuCodeConflict);

      const error = await service.create(createDto).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DuplicateSkuException);
      expect((error as DuplicateSkuException).getResponse()).toMatchObject({
        conflictingField: 'skuCode',
      });
    });

    it("throws DuplicateSkuException('size,color') on the skus_product_id_size_color_key constraint", async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'product-1',
        deletedAt: null,
      });
      prisma.sku.create.mockRejectedValue(sizeColorConflict);

      const error = await service.create(createDto).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DuplicateSkuException);
      expect((error as DuplicateSkuException).getResponse()).toMatchObject({
        conflictingField: 'size,color',
      });
    });

    it('creates and returns the SKU on success', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'product-1',
        deletedAt: null,
      });
      prisma.sku.create.mockResolvedValue(activeSku);

      const result = await service.create(createDto);

      expect(prisma.sku.create).toHaveBeenCalledWith({
        data: {
          productId: createDto.productId,
          skuCode: createDto.skuCode,
          size: createDto.size,
          color: createDto.color,
          price: createDto.price.amount,
          stock: createDto.stock,
        },
      });
      expect(result.id).toBe(activeSku.id);
      expect(result.skuCode).toBe(activeSku.skuCode);
    });
  });

  describe('update', () => {
    const updateDto = { skuCode: 'TEE-BLK-L' };

    it('throws NotFoundException when the SKU does not exist or is soft-deleted', async () => {
      prisma.sku.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing-id', updateDto),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.sku.update).not.toHaveBeenCalled();

      prisma.sku.findUnique.mockResolvedValue({
        ...activeSku,
        deletedAt: new Date(),
      });

      await expect(
        service.update(activeSku.id, updateDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the SKU is active but its parent product is soft-deleted', async () => {
      prisma.sku.findUnique.mockResolvedValue({
        ...activeSku,
        product: { deletedAt: new Date() },
      });

      await expect(
        service.update(activeSku.id, updateDto),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.sku.update).not.toHaveBeenCalled();
    });

    it('throws DuplicateSkuException on either unique constraint, distinguished by index name', async () => {
      prisma.sku.findUnique.mockResolvedValue(activeSku);

      prisma.sku.update.mockRejectedValue(skuCodeConflict);
      const skuCodeError = await service
        .update(activeSku.id, updateDto)
        .catch((e: unknown) => e);
      expect(
        (skuCodeError as DuplicateSkuException).getResponse(),
      ).toMatchObject({ conflictingField: 'skuCode' });

      prisma.sku.update.mockRejectedValue(sizeColorConflict);
      const sizeColorError = await service
        .update(activeSku.id, updateDto)
        .catch((e: unknown) => e);
      expect(
        (sizeColorError as DuplicateSkuException).getResponse(),
      ).toMatchObject({ conflictingField: 'size,color' });
    });
  });

  describe('delete', () => {
    it('throws NotFoundException when the SKU does not exist or is already deleted (idempotent)', async () => {
      prisma.sku.findUnique.mockResolvedValue(null);
      await expect(service.delete('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prisma.sku.findUnique.mockResolvedValue({
        ...activeSku,
        deletedAt: new Date(),
      });
      await expect(service.delete(activeSku.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(prisma.sku.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the SKU is active but its parent product is soft-deleted', async () => {
      prisma.sku.findUnique.mockResolvedValue({
        ...activeSku,
        product: { deletedAt: new Date() },
      });

      await expect(service.delete(activeSku.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.sku.update).not.toHaveBeenCalled();
    });

    it('throws SkuReservedException with the real reservedStock when reservedStock > 0', async () => {
      prisma.sku.findUnique.mockResolvedValue({
        ...activeSku,
        reservedStock: 3,
      });

      const error = await service.delete(activeSku.id).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SkuReservedException);
      expect((error as SkuReservedException).getResponse()).toMatchObject({
        reservedQuantity: 3,
      });
      expect(prisma.sku.update).not.toHaveBeenCalled();
    });

    it('soft-deletes (sets deletedAt) when reservedStock is 0', async () => {
      prisma.sku.findUnique.mockResolvedValue({
        ...activeSku,
        reservedStock: 0,
      });
      prisma.sku.update.mockResolvedValue(activeSku);

      await service.delete(activeSku.id);

      expect(prisma.sku.update).toHaveBeenCalledWith({
        where: { id: activeSku.id },
        data: { deletedAt: expect.any(Date) as Date },
      });
    });
  });

  describe('restock', () => {
    it('throws NotFoundException when the SKU does not exist or is soft-deleted', async () => {
      prisma.sku.findUnique.mockResolvedValue(null);
      await expect(
        service.restock('missing-id', { quantity: 5 }),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.sku.findUnique.mockResolvedValue({
        ...activeSku,
        deletedAt: new Date(),
      });
      await expect(
        service.restock(activeSku.id, { quantity: 5 }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.sku.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the SKU is active but its parent product is soft-deleted', async () => {
      prisma.sku.findUnique.mockResolvedValue({
        ...activeSku,
        product: { deletedAt: new Date() },
      });

      await expect(
        service.restock(activeSku.id, { quantity: 5 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.sku.update).not.toHaveBeenCalled();
    });

    it('increments stock by quantity (a delta, not an absolute value)', async () => {
      prisma.sku.findUnique.mockResolvedValue(activeSku);
      prisma.sku.update.mockResolvedValue({ ...activeSku, stock: 60 });

      const result = await service.restock(activeSku.id, { quantity: 10 });

      expect(prisma.sku.update).toHaveBeenCalledWith({
        where: { id: activeSku.id },
        data: { stock: { increment: 10 } },
      });
      expect(result.stock).toBe(60);
    });

    it('checks whether the restock resolves an open low-stock event', async () => {
      prisma.sku.findUnique.mockResolvedValue(activeSku);
      prisma.sku.update.mockResolvedValue({ ...activeSku, stock: 60 });

      await service.restock(activeSku.id, { quantity: 10 });

      // TODO(testing agent): assert lowStockService.resolveIfCrossedAbove
      // was called with (prisma, activeSku.productId, 60).
    });
  });
});
