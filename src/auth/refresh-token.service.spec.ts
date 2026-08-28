// `service` and `existing`/`revokeMany` helpers below are scaffolding for
// the it.todo cases — unused until those assertions are written in, not
// dead code.
/* eslint-disable @typescript-eslint/no-unused-vars */
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let prisma: {
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let configService: { getOrThrow: jest.Mock };

  // An active (non-revoked, non-expired) row — use as
  // prisma.refreshToken.findUnique.mockResolvedValue(activeRow).
  const activeRow = {
    id: 'token-row-1',
    userId: 'user-1',
    tokenHash: 'irrelevant-in-tests-since-hashToken-is-not-mocked',
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    revokedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    prisma = {
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    configService = {
      getOrThrow: jest.fn().mockReturnValue('30d'),
    };

    const module = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(RefreshTokenService);
  });

  describe('issue', () => {
    it.todo(
      'persists a hashed token (never the raw token) and returns the raw token plus its expiry',
    );
  });

  describe('rotate', () => {
    it.todo('throws InvalidRefreshTokenException when the token is unknown');

    it.todo(
      'throws InvalidRefreshTokenException when the token is already revoked',
    );

    it.todo('throws InvalidRefreshTokenException when the token is expired');

    it.todo(
      'throws InvalidRefreshTokenException when updateMany affects 0 rows (lost the race to a concurrent rotate/revoke)',
    );

    it.todo(
      'revokes the existing row and returns its userId when the token is valid',
    );
  });

  describe('revoke', () => {
    it.todo('throws InvalidRefreshTokenException when the token is unknown');

    it.todo(
      'throws InvalidRefreshTokenException when the token is already revoked',
    );

    it.todo(
      'does NOT check expiry — an expired-but-not-revoked token can still be revoked',
    );
  });
});
