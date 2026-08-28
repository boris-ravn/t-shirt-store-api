import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageUrlService } from '../../storage/image-url.service';
import { S3Service } from '../../storage/s3.service';
import { ProductImageResponseDto } from './dto/product-image-response.dto';
import { UpdateProductImageRequestDto } from './dto/update-product-image-request.dto';
import { ImageTooLargeException } from './exceptions/image-too-large.exception';
import {
  extensionForMimeType,
  MAX_IMAGE_BYTES,
} from './product-image.constants';

@Injectable()
export class ProductImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly imageUrlService: ImageUrlService,
  ) {}

  async upload(
    productId: string,
    file: Express.Multer.File,
  ): Promise<ProductImageResponseDto> {
    await this.assertProductExists(productId);

    if (file.size > MAX_IMAGE_BYTES) {
      throw new ImageTooLargeException(MAX_IMAGE_BYTES, file.size);
    }

    const s3Key = `products/${productId}/${randomUUID()}.${extensionForMimeType(file.mimetype)}`;
    await this.s3Service.upload(s3Key, file.buffer, file.mimetype);

    const position = await this.prisma.productImage.count({
      where: { productId },
    });
    const image = await this.prisma.productImage.create({
      data: { productId, s3Key, position },
    });

    return ProductImageResponseDto.fromEntity(
      image,
      this.imageUrlService.buildUrl(image.s3Key),
    );
  }

  async updatePosition(
    productId: string,
    imageId: string,
    dto: UpdateProductImageRequestDto,
  ): Promise<ProductImageResponseDto> {
    await this.assertImageExists(productId, imageId);

    const image = await this.prisma.productImage.update({
      where: { id: imageId },
      data: { position: dto.position },
    });

    return ProductImageResponseDto.fromEntity(
      image,
      this.imageUrlService.buildUrl(image.s3Key),
    );
  }

  // Hard delete — an image is never referenced by an order.
  async delete(productId: string, imageId: string): Promise<void> {
    const image = await this.assertImageExists(productId, imageId);
    await this.s3Service.delete(image.s3Key);
    await this.prisma.productImage.delete({ where: { id: imageId } });
  }

  private async assertProductExists(productId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || product.deletedAt) {
      throw new NotFoundException();
    }
  }

  private async assertImageExists(productId: string, imageId: string) {
    const image = await this.prisma.productImage.findUnique({
      where: { id: imageId },
    });
    if (!image || image.productId !== productId) {
      throw new NotFoundException();
    }
    return image;
  }
}
