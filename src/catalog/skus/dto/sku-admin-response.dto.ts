import { ApiProperty } from '@nestjs/swagger';
import { SkuResponseDto } from './sku-response.dto';

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

export class SkuAdminResponseDto extends SkuResponseDto {
  @ApiProperty()
  skuCode!: string;

  @ApiProperty({
    minimum: 0,
    description: 'Units physically held, decremented on successful payment.',
  })
  stock!: number;

  @ApiProperty({ minimum: 0, description: 'Held by pending cart orders.' })
  reservedStock!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;

  static fromEntity(sku: SkuAdminEntity): SkuAdminResponseDto {
    const dto = new SkuAdminResponseDto();
    Object.assign(dto, SkuResponseDto.fromEntity(sku));
    dto.skuCode = sku.skuCode;
    dto.stock = sku.stock;
    dto.reservedStock = sku.reservedStock;
    dto.deletedAt = sku.deletedAt;
    return dto;
  }
}
