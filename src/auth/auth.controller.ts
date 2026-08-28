import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { AuthSessionResponseDto } from './dto/auth-session-response.dto';
import { RefreshTokensRequestDto } from './dto/refresh-tokens-request.dto';
import { SignInRequestDto } from './dto/sign-in-request.dto';
import { SignOutRequestDto } from './dto/sign-out-request.dto';
import { SignUpRequestDto } from './dto/sign-up-request.dto';

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @ApiOperation({ summary: 'Register a new client account' })
  @ApiCreatedResponse({ type: AuthSessionResponseDto })
  signUp(@Body() dto: SignUpRequestDto): Promise<AuthSessionResponseDto> {
    return this.authService.signUp(dto);
  }

  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiOkResponse({ type: AuthSessionResponseDto })
  signIn(@Body() dto: SignInRequestDto): Promise<AuthSessionResponseDto> {
    return this.authService.signIn(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new session' })
  @ApiOkResponse({ type: AuthSessionResponseDto })
  refreshTokens(
    @Body() dto: RefreshTokensRequestDto,
  ): Promise<AuthSessionResponseDto> {
    return this.authService.refreshTokens(dto);
  }

  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiNoContentResponse()
  async signOut(@Body() dto: SignOutRequestDto): Promise<void> {
    await this.authService.signOut(dto);
  }
}
