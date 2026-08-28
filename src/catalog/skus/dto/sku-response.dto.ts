import { ApiProperty } from '@nestjs/swagger';
import { MoneyDto } from '../../../common/money/money.dto';

interface SkuEntity {
  id: string;
  size: string;
  color: string;
  price: number;
  stock: number;
  reservedStock: number;
}

// Client-facing SKU. Raw stock counters are not exposed — see SkuAdminResponseDto.
export class SkuResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  size!: string;

  @ApiProperty()
  color!: string;

  @ApiProperty({ type: MoneyDto })
  price!: MoneyDto;

  @ApiProperty({
    minimum: 0,
    description: 'Derived as `stock - reservedStock`. No column behind it.',
  })
  availableQuantity!: number;

  static fromEntity(sku: SkuEntity): SkuResponseDto {
    const dto = new SkuResponseDto();
    dto.id = sku.id;
    dto.size = sku.size;
    dto.color = sku.color;
    dto.price = MoneyDto.of(sku.price);
    dto.availableQuantity = sku.stock - sku.reservedStock;
    return dto;
  }
}
