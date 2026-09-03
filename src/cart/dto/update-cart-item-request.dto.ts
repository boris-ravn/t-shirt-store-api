import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

// Absolute, not a delta — quantity: 0 is a validation failure, deletion has
// its own verb (removeCartItem).
export class UpdateCartItemRequestDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}
