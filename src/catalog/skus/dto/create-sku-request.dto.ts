import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { MoneyRequestDto } from '../../../common/money/money-request.dto';

// productId is a body field: POST /v1/skus has no product path segment.
export class CreateSkuRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty()
  @IsString()
  skuCode!: string;

  @ApiProperty()
  @IsString()
  size!: string;

  @ApiProperty()
  @IsString()
  color!: string;

  @ApiProperty({ type: MoneyRequestDto })
  @ValidateNested()
  @Type(() => MoneyRequestDto)
  price!: MoneyRequestDto;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  stock!: number;
}
