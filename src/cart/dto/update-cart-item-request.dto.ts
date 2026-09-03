import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

// Absolute, not a delta — removeCartItem is the verb for going to zero.
export class UpdateCartItemRequestDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}
