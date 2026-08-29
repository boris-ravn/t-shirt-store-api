import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class RequestPasswordResetRequestDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  email!: string;
}
