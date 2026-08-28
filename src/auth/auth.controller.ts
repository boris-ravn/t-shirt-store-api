import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { AuthSessionResponseDto } from './dto/auth-session-response.dto';
import { RefreshTokensRequestDto } from './dto/refresh-tokens-request.dto';
import { RequestPasswordResetRequestDto } from './dto/request-password-reset-request.dto';
import { ResetPasswordRequestDto } from './dto/reset-password-request.dto';
import { SignInRequestDto } from './dto/sign-in-request.dto';
import { SignOutRequestDto } from './dto/sign-out-request.dto';
import { SignUpRequestDto } from './dto/sign-up-request.dto';

// Tighter than the global default — brute-forcing a password or flooding
// the reset-email flow is the real risk on these three, not sign-up/refresh.
const STRICT_AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

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
  @Throttle(STRICT_AUTH_THROTTLE)
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

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(STRICT_AUTH_THROTTLE)
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiAcceptedResponse({
    description: 'An email was sent if the address belongs to an account.',
  })
  async requestPasswordReset(
    @Body() dto: RequestPasswordResetRequestDto,
  ): Promise<void> {
    await this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(STRICT_AUTH_THROTTLE)
  @ApiOperation({ summary: 'Reset a password using a reset token' })
  @ApiNoContentResponse()
  async resetPassword(@Body() dto: ResetPasswordRequestDto): Promise<void> {
    await this.authService.resetPassword(dto);
  }
}
