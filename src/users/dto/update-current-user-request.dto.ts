import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

// email, role and password are deliberately absent — none is updatable here.
export class UpdateCurrentUserRequestDto {
  @ApiProperty()
  @IsString()
  firstName!: string;

  @ApiProperty()
  @IsString()
  lastName!: string;
}
