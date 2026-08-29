import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCurrentUserRequestDto } from './dto/update-current-user-request.dto';
import { UserResponseDto } from './dto/user-response.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // NotFoundException here falls through to the generic `not-found`
  // fallback in ProblemExceptionFilter — there's no dedicated Problem slug
  // for it because it shouldn't be reachable: a valid access token's
  // subject always resolves, since nothing in this schema ever deletes a
  // user row.
  async findById(id: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException();
    }
    return UserResponseDto.fromEntity(user);
  }

  async updateProfile(
    id: string,
    dto: UpdateCurrentUserRequestDto,
  ): Promise<UserResponseDto> {
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
    });
    return UserResponseDto.fromEntity(user);
  }
}
