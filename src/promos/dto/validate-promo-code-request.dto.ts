import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ValidatePromoCodeRequestDto {
  @ApiProperty()
  @IsString()
  code!: string;
}
