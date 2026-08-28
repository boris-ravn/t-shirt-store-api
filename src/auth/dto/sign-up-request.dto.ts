import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

// `role` is deliberately absent — forbidNonWhitelisted rejects it outright
// rather than silently ignoring it, closing the privilege-escalation path
// docs/database/README.md calls out for sign-up.
export class SignUpRequestDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty()
  @IsString()
  firstName!: string;

  @ApiProperty()
  @IsString()
  lastName!: string;
}
