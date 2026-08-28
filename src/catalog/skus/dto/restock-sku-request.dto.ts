import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class RestockSkuRequestDto {
  @ApiProperty({
    minimum: 1,
    description: 'A delta added to `stock`, not an absolute value.',
  })
  @IsInt()
  @Min(1)
  quantity!: number;
}
