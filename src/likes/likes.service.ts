import { Injectable, NotFoundException } from '@nestjs/common';
import { ProductListResponseDto } from '../catalog/products/dto/product-list-response.dto';
import { ProductResponseDto } from '../catalog/products/dto/product-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ProductStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { ImageUrlService } from '../storage/image-url.service';

const LIKED_PRODUCT_INCLUDE = {
  images: { orderBy: { position: 'asc' as const } },
  skus: { where: { deletedAt: null } },
};

@Injectable()
export class LikesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly imageUrlService: ImageUrlService,
  ) {}

  async like(userId: string, productId: string): Promise<void> {
    await this.assertProductLikeable(productId);
    await this.prisma.like.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId },
      update: {},
    });
  }

  // Only requires the product to exist, not to be active — a disable must
  // not strand a client's like with no way to remove it.
  async unlike(userId: string, productId: string): Promise<void> {
    await this.assertProductExists(productId);
    await this.prisma.like.deleteMany({ where: { userId, productId } });
  }

  async listLikedProducts(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<ProductListResponseDto> {
    const where = {
      userId,
      product: { deletedAt: null, status: ProductStatus.active },
    };

    const [likes, total] = await Promise.all([
      this.prisma.like.findMany({
        where,
        include: { product: { include: LIKED_PRODUCT_INCLUDE } },
        orderBy: { createdAt: 'desc' as const },
        skip: query.offset,
        take: query.limit,
      }),
      this.prisma.like.count({ where }),
    ]);

    return {
      data: likes.map((like) =>
        ProductResponseDto.fromEntity(like.product, (s3Key) =>
          this.imageUrlService.buildUrl(s3Key),
        ),
      ),
      meta: { total, limit: query.limit, offset: query.offset },
    };
  }

  private async assertProductExists(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || product.deletedAt) {
      throw new NotFoundException();
    }
    return product;
  }

  private async assertProductLikeable(productId: string): Promise<void> {
    const product = await this.assertProductExists(productId);
    if (product.status === ProductStatus.disabled) {
      throw new NotFoundException();
    }
  }
}
