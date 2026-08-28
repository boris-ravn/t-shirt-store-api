// `service` and `activeRow` below are scaffolding for the it.todo cases —
// unused until those assertions are written in, not dead code.
/* eslint-disable @typescript-eslint/no-unused-vars */
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordResetTokenService } from './password-reset-token.service';

describe('PasswordResetTokenService', () => {
  let service: PasswordResetTokenService;
  let prisma: {
    passwordResetToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let configService: { getOrThrow: jest.Mock };

  // An active (unused, non-expired) row — use as
  // prisma.passwordResetToken.findUnique.mockResolvedValue(activeRow).
  const activeRow = {
    id: 'reset-token-1',
    userId: 'user-1',
    tokenHash: 'irrelevant-in-tests-since-hashToken-is-not-mocked',
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    usedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    prisma = {
      passwordResetToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    configService = {
      getOrThrow: jest.fn().mockReturnValue('1h'),
    };

    const module = await Test.createTestingModule({
      providers: [
        PasswordResetTokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(PasswordResetTokenService);
  });

  describe('issue', () => {
    it.todo(
      'invalidates any previous unused tokens for the user before creating the new one',
    );

    it.todo(
      'persists a hashed token (never the raw token) and returns the raw token',
    );
  });

  describe('consume', () => {
    it.todo('throws InvalidResetTokenException when the token is unknown');

    it.todo('throws InvalidResetTokenException when the token is already used');

    it.todo('throws InvalidResetTokenException when the token is expired');

    it.todo(
      'throws InvalidResetTokenException when updateMany affects 0 rows (lost the race to a concurrent consume)',
    );

    it.todo(
      'marks the token used and returns its userId when the token is valid',
    );
  });
});
