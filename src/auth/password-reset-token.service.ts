import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ms from 'ms';
import type { StringValue } from 'ms';
import { generateOpaqueToken, hashToken } from '../common/crypto/token.util';
import { PrismaService } from '../prisma/prisma.service';
import { InvalidResetTokenException } from './exceptions/invalid-reset-token.exception';

export interface ConsumedResetToken {
  userId: string;
}

@Injectable()
export class PasswordResetTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  // Issuing a new token invalidates any previous unused ones for the same
  // user, so an old reset link found later in an inbox can't still work.
  async issue(userId: string): Promise<string> {
    await this.prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = generateOpaqueToken();
    const expiresAt = new Date(
      Date.now() +
        ms(
          this.configService.getOrThrow<string>(
            'PASSWORD_RESET_TOKEN_EXPIRES_IN',
          ) as StringValue,
        ),
    );

    await this.prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt,
      },
    });

    return token;
  }

  // The updateMany guard (WHERE id AND usedAt IS NULL) closes the same
  // double-use race refresh-token rotation guards against.
  async consume(rawToken: string): Promise<ConsumedResetToken> {
    const existing = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    if (!existing || existing.usedAt || existing.expiresAt < new Date()) {
      throw new InvalidResetTokenException();
    }

    const result = await this.prisma.passwordResetToken.updateMany({
      where: { id: existing.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (result.count === 0) {
      throw new InvalidResetTokenException();
    }

    return { userId: existing.userId };
  }
}
