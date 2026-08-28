import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/enums';

interface UserEntity {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  passwordChangedAt: Date | null;
  createdAt: Date;
}

// Explicit field-by-field mapping, not a class-transformer @Exclude()/
// @Expose() pass — that only strips passwordHash if something remembers to
// route the return value through ClassSerializerInterceptor. Listing the
// allowed fields here means passwordHash can never leak by omission.
export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  passwordChangedAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static fromEntity(user: UserEntity): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.firstName = user.firstName;
    dto.lastName = user.lastName;
    dto.role = user.role;
    dto.passwordChangedAt = user.passwordChangedAt;
    dto.createdAt = user.createdAt;
    return dto;
  }
}
