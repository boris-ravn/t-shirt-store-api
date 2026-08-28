import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ms from 'ms';
import type { StringValue } from 'ms';
import { PrismaService } from '../prisma/prisma.service';
import { generateOpaqueToken, hashToken } from '../common/crypto/token.util';
import { InvalidRefreshTokenException } from './exceptions/invalid-refresh-token.exception';

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

export interface RotatedRefreshToken {
  userId: string;
}

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async issue(userId: string): Promise<IssuedRefreshToken> {
    const token = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + ms(this.refreshExpiresIn()));

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt,
      },
    });

    return { token, expiresAt };
  }

  // The `updateMany` only touches the row if it is still `revokedAt: null`,
  // so two concurrent refreshes on the same token can't both "win".
  async rotate(rawToken: string): Promise<RotatedRefreshToken> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      throw new InvalidRefreshTokenException();
    }

    await this.revokeRowOrThrow(existing.id);

    return { userId: existing.userId };
  }

  // Sign-out: same revoke, but an already-expired token is still a valid
  // thing to sign out of — only "unknown" or "already revoked" are errors.
  async revoke(rawToken: string): Promise<void> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    if (!existing || existing.revokedAt) {
      throw new InvalidRefreshTokenException();
    }

    await this.revokeRowOrThrow(existing.id);
  }

  private async revokeRowOrThrow(id: string): Promise<void> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (result.count === 0) {
      throw new InvalidRefreshTokenException();
    }
  }

  private refreshExpiresIn(): StringValue {
    return this.configService.getOrThrow<string>(
      'JWT_REFRESH_EXPIRES_IN',
    ) as StringValue;
  }
}
