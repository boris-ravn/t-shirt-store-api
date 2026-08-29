import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user.interface';
import { UpdateCurrentUserRequestDto } from './dto/update-current-user-request.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: "Get the caller's own profile" })
  @ApiOkResponse({ type: UserResponseDto })
  getCurrentUser(
    @CurrentUser() user: AuthenticatedUser | null,
  ): Promise<UserResponseDto> {
    // JwtAuthGuard above guarantees req.user is set — it throws before this
    // handler runs otherwise.
    return this.usersService.findById(user!.id);
  }

  @Patch('me')
  @ApiOperation({ summary: "Update the caller's own profile" })
  @ApiOkResponse({ type: UserResponseDto })
  updateCurrentUser(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body() dto: UpdateCurrentUserRequestDto,
  ): Promise<UserResponseDto> {
    return this.usersService.updateProfile(user!.id, dto);
  }
}
