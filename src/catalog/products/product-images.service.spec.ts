// `service` and `existingImage` below are scaffolding for the it.todo
// cases — unused until those assertions are written in, not dead code.
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageUrlService } from '../../storage/image-url.service';
import { S3Service } from '../../storage/s3.service';
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

  describe('upload', () => {
    it.todo(
      'throws NotFoundException when the product does not exist or is soft-deleted',
    );

    it.todo(
      'throws ImageTooLargeException with the real file size, without calling s3Service.upload',
    );

    it.todo('uploads to S3 and persists position = current image count');
  });

  describe('updatePosition', () => {
    it.todo(
      'throws NotFoundException when the image does not exist, or belongs to a different product',
    );

    it.todo('updates position and returns the image');
  });

  describe('delete', () => {
    it.todo(
      'throws NotFoundException when the image does not exist, or belongs to a different product',
    );

    it.todo('deletes from S3 before deleting the DB row');
  });
});
