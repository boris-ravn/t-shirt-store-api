import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { MoneyRequestDto } from '../../../common/money/money-request.dto';

// `stock` is deliberately absent — restockSku is the only supported write
// to it (an absolute PATCH would clobber concurrent reserve/fulfil updates).
export class UpdateSkuRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  skuCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  size?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ type: MoneyRequestDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyRequestDto)
  price?: MoneyRequestDto;
}
