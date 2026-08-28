import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class UpdateProductImageRequestDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  position!: number;
}
