import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import ms from 'ms';
import type { StringValue } from 'ms';
import { UserRole } from '../generated/prisma/enums';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueConstraintViolation } from '../prisma/prisma-error.util';
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
    // Fast path only — two concurrent sign-ups for the same email can both
    // pass this check before either create() commits, so the real guarantee
    // is the catch below, not this lookup.
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new EmailAlreadyRegisteredException();
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new EmailAlreadyRegisteredException();
      }
      throw error;
    }

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

  // Always resolves, whether or not the email belongs to an account, so
  // this endpoint can't be used to enumerate registered emails.
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

    // A reset must both change the password and kill any session an
    // attacker may already hold — same transaction, so neither can succeed
    // without the other.
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      await this.refreshTokenService.revokeAllForUser(userId, tx);
      return updated;
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
