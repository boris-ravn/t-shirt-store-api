import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

// email, role and password are deliberately absent — none is updatable
// through this endpoint (see docs/api/components/schemas/user.yaml).
export class UpdateCurrentUserRequestDto {
  @ApiProperty()
  @IsString()
  firstName!: string;

  @ApiProperty()
  @IsString()
  lastName!: string;
}
