import { ApiProperty } from '@nestjs/swagger';
import { SkuResponseDto } from '../../catalog/skus/dto/sku-response.dto';
import { MoneyDto } from '../../common/money/money.dto';

interface CartItemSkuEntity {
  id: string;
  size: string;
  color: string;
  price: number;
  stock: number;
  reservedStock: number;
}

interface CartItemProductEntity {
  id: string;
  name: string;
  images: { s3Key: string }[];
}

export interface CartItemEntity {
  id: string;
  quantity: number;
  sku: CartItemSkuEntity & { product: CartItemProductEntity };
}

export class CartItemProductResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true, format: 'uri' })
  imageUrl!: string | null;
}

// Prices are read live from the SKU, not snapshotted — unlike order_items.
export class CartItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ minimum: 1 })
  quantity!: number;

  @ApiProperty({ type: MoneyDto })
  lineTotal!: MoneyDto;

  @ApiProperty({
    minimum: 0,
    description:
      "From the line's SKU. Lets a client flag a line as unpurchasable before checkout fails.",
  })
  availableQuantity!: number;

  @ApiProperty({ type: SkuResponseDto })
  sku!: SkuResponseDto;

  @ApiProperty({ type: CartItemProductResponseDto })
  product!: CartItemProductResponseDto;

  static fromEntity(
    item: CartItemEntity,
    resolveImageUrl: (s3Key: string) => string,
  ): CartItemResponseDto {
    const dto = new CartItemResponseDto();
    dto.id = item.id;
    dto.quantity = item.quantity;
    dto.lineTotal = MoneyDto.of(item.sku.price * item.quantity);
    dto.availableQuantity = item.sku.stock - item.sku.reservedStock;
    dto.sku = SkuResponseDto.fromEntity(item.sku);
    const [coverImage] = item.sku.product.images;
    dto.product = {
      id: item.sku.product.id,
      name: item.sku.product.name,
      imageUrl: coverImage ? resolveImageUrl(coverImage.s3Key) : null,
    };
    return dto;
  }
}
