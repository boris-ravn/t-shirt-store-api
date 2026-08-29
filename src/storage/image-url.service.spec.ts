import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ImageUrlService } from './image-url.service';

describe('ImageUrlService', () => {
  let service: ImageUrlService;
  let configService: { getOrThrow: jest.Mock; get: jest.Mock };

  beforeEach(async () => {
    configService = {
      getOrThrow: jest.fn(),
      get: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        ImageUrlService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(ImageUrlService);
  });

  describe('buildUrl', () => {
    it('builds a path-style URL against AWS_S3_ENDPOINT when it is set (MinIO in dev/test)', () => {
      configService.getOrThrow.mockReturnValue('tshirt-store-dev');
      configService.get.mockReturnValue('http://localhost:9000');

      const url = service.buildUrl('products/product-1/some-uuid.png');

      expect(url).toBe(
        'http://localhost:9000/tshirt-store-dev/products/product-1/some-uuid.png',
      );
    });

    it('builds a virtual-hosted-style AWS URL when AWS_S3_ENDPOINT is unset', () => {
      configService.get.mockReturnValue(undefined);
      configService.getOrThrow.mockImplementation((key: string) =>
        key === 'AWS_S3_BUCKET' ? 'tshirt-store-dev' : 'us-east-1',
      );

      const url = service.buildUrl('products/product-1/some-uuid.png');

      expect(url).toBe(
        'https://tshirt-store-dev.s3.us-east-1.amazonaws.com/products/product-1/some-uuid.png',
      );
    });
  });
});
