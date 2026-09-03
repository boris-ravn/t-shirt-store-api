import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateOrderRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  promoCode?: string;
}
