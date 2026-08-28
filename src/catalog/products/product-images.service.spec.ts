import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageUrlService } from '../../storage/image-url.service';
import { S3Service } from '../../storage/s3.service';
import { ImageTooLargeException } from './exceptions/image-too-large.exception';
import { MAX_IMAGE_BYTES } from './product-image.constants';
import { ProductImagesService } from './product-images.service';

describe('ProductImagesService', () => {
  let service: ProductImagesService;
  let prisma: {
    product: { findUnique: jest.Mock };
    productImage: {
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let s3Service: { upload: jest.Mock; delete: jest.Mock };
  let imageUrlService: { buildUrl: jest.Mock };

  const existingImage = {
    id: 'image-1',
    productId: 'product-1',
    s3Key: 'products/product-1/some-uuid.png',
    position: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  // A 6 MiB in-memory file — exceeds MAX_IMAGE_BYTES (5 MiB). The mimetype
  // check (fileFilter, rejecting before this service ever runs) is covered
  // at the controller/e2e level, not here.
  const oversizedFile = {
    fieldname: 'file',
    originalname: 'big.png',
    mimetype: 'image/png',
    size: 6 * 1024 * 1024,
    buffer: Buffer.alloc(6 * 1024 * 1024),
  } as Express.Multer.File;

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn() },
      productImage: {
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    s3Service = { upload: jest.fn(), delete: jest.fn() };
    imageUrlService = {
      buildUrl: jest.fn().mockReturnValue('https://example.com/image.png'),
    };

    const module = await Test.createTestingModule({
      providers: [
        ProductImagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: S3Service, useValue: s3Service },
        { provide: ImageUrlService, useValue: imageUrlService },
      ],
    }).compile();

    service = module.get(ProductImagesService);
  });

  const validFile = {
    fieldname: 'file',
    originalname: 'shirt.png',
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from('fake-image-bytes'),
  } as Express.Multer.File;

  describe('upload', () => {
    it('throws NotFoundException when the product does not exist or is soft-deleted', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.upload('product-1', validFile),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(s3Service.upload).not.toHaveBeenCalled();

      prisma.product.findUnique.mockResolvedValue({
        id: 'product-1',
        deletedAt: new Date(),
      });

      await expect(
        service.upload('product-1', validFile),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(s3Service.upload).not.toHaveBeenCalled();
    });

    it('throws ImageTooLargeException with the real file size, without calling s3Service.upload', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'product-1',
        deletedAt: null,
      });

      const error = await service
        .upload('product-1', oversizedFile)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ImageTooLargeException);
      expect((error as ImageTooLargeException).getResponse()).toMatchObject({
        maxBytes: MAX_IMAGE_BYTES,
        receivedBytes: oversizedFile.size,
      });
      expect(s3Service.upload).not.toHaveBeenCalled();
      expect(prisma.productImage.create).not.toHaveBeenCalled();
    });

    it('uploads to S3 and persists position = current image count', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'product-1',
        deletedAt: null,
      });
      // Two images already exist for this product — the trivial case (0)
      // would pass even if `position` were hardcoded instead of derived.
      prisma.productImage.count.mockResolvedValue(2);
      prisma.productImage.create.mockImplementation(
        ({
          data,
        }: {
          data: { productId: string; s3Key: string; position: number };
        }) =>
          Promise.resolve({
            id: 'image-3',
            productId: data.productId,
            s3Key: data.s3Key,
            position: data.position,
            createdAt: new Date('2026-01-02T00:00:00Z'),
          }),
      );

      const result = await service.upload('product-1', validFile);

      expect(prisma.productImage.count).toHaveBeenCalledWith({
        where: { productId: 'product-1' },
      });
      expect(s3Service.upload).toHaveBeenCalledWith(
        expect.stringMatching(/^products\/product-1\/.+\.png$/),
        validFile.buffer,
        validFile.mimetype,
      );
      expect(prisma.productImage.create).toHaveBeenCalledWith({
        data: {
          productId: 'product-1',
          s3Key: expect.stringMatching(
            /^products\/product-1\/.+\.png$/,
          ) as string,
          position: 2,
        },
      });
      expect(result.position).toBe(2);
      expect(result.url).toBe('https://example.com/image.png');
    });
  });

  describe('updatePosition', () => {
    it('throws NotFoundException when the image does not exist, or belongs to a different product', async () => {
      prisma.productImage.findUnique.mockResolvedValue(null);

      await expect(
        service.updatePosition('product-1', 'missing-image', { position: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.productImage.update).not.toHaveBeenCalled();

      prisma.productImage.findUnique.mockResolvedValue({
        ...existingImage,
        productId: 'other-product',
      });

      await expect(
        service.updatePosition('product-1', existingImage.id, { position: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.productImage.update).not.toHaveBeenCalled();
    });

    it('updates position and returns the image', async () => {
      prisma.productImage.findUnique.mockResolvedValue(existingImage);
      prisma.productImage.update.mockResolvedValue({
        ...existingImage,
        position: 3,
      });

      const result = await service.updatePosition(
        existingImage.productId,
        existingImage.id,
        { position: 3 },
      );

      expect(prisma.productImage.update).toHaveBeenCalledWith({
        where: { id: existingImage.id },
        data: { position: 3 },
      });
      expect(result.position).toBe(3);
    });
  });

  describe('delete', () => {
    it('throws NotFoundException when the image does not exist, or belongs to a different product', async () => {
      prisma.productImage.findUnique.mockResolvedValue(null);

      await expect(
        service.delete('product-1', 'missing-image'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(s3Service.delete).not.toHaveBeenCalled();
      expect(prisma.productImage.delete).not.toHaveBeenCalled();

      prisma.productImage.findUnique.mockResolvedValue({
        ...existingImage,
        productId: 'other-product',
      });

      await expect(
        service.delete('product-1', existingImage.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(s3Service.delete).not.toHaveBeenCalled();
      expect(prisma.productImage.delete).not.toHaveBeenCalled();
    });

    it('deletes from S3 before deleting the DB row', async () => {
      prisma.productImage.findUnique.mockResolvedValue(existingImage);
      prisma.productImage.delete.mockResolvedValue(existingImage);

      await service.delete(existingImage.productId, existingImage.id);

      expect(s3Service.delete).toHaveBeenCalledWith(existingImage.s3Key);
      expect(prisma.productImage.delete).toHaveBeenCalledWith({
        where: { id: existingImage.id },
      });
      const s3DeleteOrder = s3Service.delete.mock.invocationCallOrder[0];
      const dbDeleteOrder =
        prisma.productImage.delete.mock.invocationCallOrder[0];
      expect(s3DeleteOrder).toBeLessThan(dbDeleteOrder);
    });
  });
});
