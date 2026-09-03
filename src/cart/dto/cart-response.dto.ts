import { ApiProperty } from '@nestjs/swagger';
import { MoneyDto } from '../../common/money/money.dto';
import { CartItemEntity, CartItemResponseDto } from './cart-item-response.dto';

interface CartEntity {
  id: string;
  items: CartItemEntity[];
  updatedAt: Date;
}

export class CartResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: [CartItemResponseDto] })
  items!: CartItemResponseDto[];

  @ApiProperty({ type: MoneyDto })
  subtotal!: MoneyDto;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  static fromEntity(
    cart: CartEntity,
    resolveImageUrl: (s3Key: string) => string,
  ): CartResponseDto {
    const dto = new CartResponseDto();
    dto.id = cart.id;
    dto.items = cart.items.map((item) =>
      CartItemResponseDto.fromEntity(item, resolveImageUrl),
    );
    const subtotalMinorUnits = cart.items.reduce(
      (sum, item) => sum + item.sku.price * item.quantity,
      0,
    );
    dto.subtotal = MoneyDto.of(subtotalMinorUnits);
    dto.updatedAt = cart.updatedAt;
    return dto;
  }
}
