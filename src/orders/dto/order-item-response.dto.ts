import { ApiProperty } from '@nestjs/swagger';
import { MoneyDto } from '../../common/money/money.dto';

interface OrderItemEntity {
  id: string;
  productId: string;
  skuId: string;
  productName: string;
  size: string;
  color: string;
  quantity: number;
  unitPrice: number;
}

export class OrderItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ format: 'uuid' })
  skuId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  size!: string;

  @ApiProperty()
  color!: string;

  @ApiProperty({ minimum: 1 })
  quantity!: number;

  @ApiProperty({ type: MoneyDto })
  unitPrice!: MoneyDto;

  static fromEntity(item: OrderItemEntity): OrderItemResponseDto {
    const dto = new OrderItemResponseDto();
    dto.id = item.id;
    dto.productId = item.productId;
    dto.skuId = item.skuId;
    dto.productName = item.productName;
    dto.size = item.size;
    dto.color = item.color;
    dto.quantity = item.quantity;
    dto.unitPrice = MoneyDto.of(item.unitPrice);
    return dto;
  }
}
