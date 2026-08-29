import { ApiProperty } from '@nestjs/swagger';
import { ProductStatus } from '../../../generated/prisma/enums';
import { SkuAdminResponseDto } from '../../skus/dto/sku-admin-response.dto';
import { ProductImageResponseDto } from './product-image-response.dto';

interface ProductImageEntity {
  id: string;
  s3Key: string;
  position: number;
  createdAt: Date;
}

interface SkuAdminEntity {
  id: string;
  size: string;
  color: string;
  price: number;
  stock: number;
  reservedStock: number;
  skuCode: string;
  deletedAt: Date | null;
}

interface ProductAdminEntity {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  status: ProductStatus;
  images: ProductImageEntity[];
  skus: SkuAdminEntity[];
  createdAt: Date;
  updatedAt: Date;
}

// Manager-facing product — a separate class from ProductResponseDto rather
// than a subclass overriding `skus`' element type, since TS class-field
// override variance for that shape isn't worth relying on for a Swagger DTO.
export class ProductAdminResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  categoryId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ enum: ProductStatus })
  status!: ProductStatus;

  @ApiProperty({ type: [ProductImageResponseDto] })
  images!: ProductImageResponseDto[];

  @ApiProperty({ type: [SkuAdminResponseDto] })
  skus!: SkuAdminResponseDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  static fromEntity(
    product: ProductAdminEntity,
    resolveImageUrl: (s3Key: string) => string,
  ): ProductAdminResponseDto {
    const dto = new ProductAdminResponseDto();
    dto.id = product.id;
    dto.categoryId = product.categoryId;
    dto.name = product.name;
    dto.description = product.description;
    dto.status = product.status;
    dto.images = [...product.images]
      .sort((a, b) => a.position - b.position)
      .map((image) =>
        ProductImageResponseDto.fromEntity(image, resolveImageUrl(image.s3Key)),
      );
    dto.skus = product.skus.map((sku) => SkuAdminResponseDto.fromEntity(sku));
    dto.createdAt = product.createdAt;
    dto.updatedAt = product.updatedAt;
    return dto;
  }
}
