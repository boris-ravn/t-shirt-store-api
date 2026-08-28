import { ApiProperty } from '@nestjs/swagger';
import { SkuResponseDto } from '../../skus/dto/sku-response.dto';
import { ProductImageResponseDto } from './product-image-response.dto';

interface ProductImageEntity {
  id: string;
  s3Key: string;
  position: number;
  createdAt: Date;
}

interface SkuEntity {
  id: string;
  size: string;
  color: string;
  price: number;
  stock: number;
  reservedStock: number;
}

interface ProductEntity {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  images: ProductImageEntity[];
  skus: SkuEntity[];
  createdAt: Date;
  updatedAt: Date;
}

// Client-facing product — the active/non-deleted scoping is enforced by the
// query that produced it, not by this DTO. See ProductAdminResponseDto for
// the manager-facing shape.
export class ProductResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  categoryId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: [ProductImageResponseDto] })
  images!: ProductImageResponseDto[];

  @ApiProperty({ type: [SkuResponseDto] })
  skus!: SkuResponseDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  static fromEntity(
    product: ProductEntity,
    resolveImageUrl: (s3Key: string) => string,
  ): ProductResponseDto {
    const dto = new ProductResponseDto();
    dto.id = product.id;
    dto.categoryId = product.categoryId;
    dto.name = product.name;
    dto.description = product.description;
    dto.images = [...product.images]
      .sort((a, b) => a.position - b.position)
      .map((image) =>
        ProductImageResponseDto.fromEntity(image, resolveImageUrl(image.s3Key)),
      );
    dto.skus = product.skus.map((sku) => SkuResponseDto.fromEntity(sku));
    dto.createdAt = product.createdAt;
    dto.updatedAt = product.updatedAt;
    return dto;
  }
}
