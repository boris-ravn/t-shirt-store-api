import { ApiProperty } from '@nestjs/swagger';

interface ProductImageEntity {
  id: string;
  position: number;
  createdAt: Date;
}

export class ProductImageResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    format: 'uri',
    description:
      'Built at response time from the S3 object key, not stored as a URL.',
  })
  url!: string;

  @ApiProperty({ minimum: 0 })
  position!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static fromEntity(
    image: ProductImageEntity,
    url: string,
  ): ProductImageResponseDto {
    const dto = new ProductImageResponseDto();
    dto.id = image.id;
    dto.url = url;
    dto.position = image.position;
    dto.createdAt = image.createdAt;
    return dto;
  }
}
