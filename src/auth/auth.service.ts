import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import ms from 'ms';
import type { StringValue } from 'ms';
import { UserRole } from '../generated/prisma/enums';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthSessionResponseDto } from './dto/auth-session-response.dto';
import { RefreshTokensRequestDto } from './dto/refresh-tokens-request.dto';
import { RequestPasswordResetRequestDto } from './dto/request-password-reset-request.dto';
import { ResetPasswordRequestDto } from './dto/reset-password-request.dto';
import { SignInRequestDto } from './dto/sign-in-request.dto';
import { SignOutRequestDto } from './dto/sign-out-request.dto';
import { SignUpRequestDto } from './dto/sign-up-request.dto';
import { EmailAlreadyRegisteredException } from './exceptions/email-already-registered.exception';
import { InvalidCredentialsException } from './exceptions/invalid-credentials.exception';
import { PasswordResetTokenService } from './password-reset-token.service';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';

interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  passwordChangedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly passwordResetTokenService: PasswordResetTokenService,
    private readonly mailService: MailService,
  ) {}

  async signUp(dto: SignUpRequestDto): Promise<AuthSessionResponseDto> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new EmailAlreadyRegisteredException();
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
    });

    return this.issueSession(user);
  }

  async signIn(dto: SignInRequestDto): Promise<AuthSessionResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      throw new InvalidCredentialsException();
    }

    const passwordMatches = await this.passwordService.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new InvalidCredentialsException();
    }

    return this.issueSession(user);
  }

  async refreshTokens(
    dto: RefreshTokensRequestDto,
  ): Promise<AuthSessionResponseDto> {
    const { userId } = await this.refreshTokenService.rotate(dto.refreshToken);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    return this.issueSession(user);
  }

  async signOut(dto: SignOutRequestDto): Promise<void> {
    await this.refreshTokenService.revoke(dto.refreshToken);
  }

  // Always resolves — 202 regardless of whether the email belongs to an
  // account, so this endpoint can't be used to enumerate registered
  // emails (see docs/api/paths/auth.yaml#/requestPasswordReset).
  async forgotPassword(dto: RequestPasswordResetRequestDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      return;
    }

    const token = await this.passwordResetTokenService.issue(user.id);
    await this.mailService.sendPasswordResetEmail(
      user.email,
      user.firstName,
      token,
    );
  }

  async resetPassword(dto: ResetPasswordRequestDto): Promise<void> {
    const { userId } = await this.passwordResetTokenService.consume(dto.token);
    const passwordHash = await this.passwordService.hash(dto.password);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: new Date() },
    });

    await this.mailService.sendPasswordChangedEmail(user.email, user.firstName);
  }

  private async issueSession(
    user: SessionUser,
  ): Promise<AuthSessionResponseDto> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      role: user.role,
    });
    const { token: refreshToken } = await this.refreshTokenService.issue(
      user.id,
    );
    const accessExpiresIn = this.configService.getOrThrow<string>(
      'JWT_ACCESS_EXPIRES_IN',
    ) as StringValue;

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(ms(accessExpiresIn) / 1000),
      user: UserResponseDto.fromEntity(user),
    };
  }
}
