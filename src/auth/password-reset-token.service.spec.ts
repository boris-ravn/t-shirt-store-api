import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { hashToken } from '../common/crypto/token.util';
import { PrismaService } from '../prisma/prisma.service';
import { InvalidResetTokenException } from './exceptions/invalid-reset-token.exception';
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

  // An active (unused, non-expired) row.
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
    it('invalidates any previous unused tokens for the user before creating the new one', async () => {
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.passwordResetToken.create.mockResolvedValue(activeRow);

      await service.issue('user-1');

      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', usedAt: null },
        data: { usedAt: expect.any(Date) as Date },
      });
      const updateManyOrder =
        prisma.passwordResetToken.updateMany.mock.invocationCallOrder[0];
      const createOrder =
        prisma.passwordResetToken.create.mock.invocationCallOrder[0];
      expect(updateManyOrder).toBeLessThan(createOrder);
    });

    it('persists a hashed token (never the raw token) and returns the raw token', async () => {
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.passwordResetToken.create.mockResolvedValue(activeRow);

      const token = await service.issue('user-1');

      expect(prisma.passwordResetToken.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          tokenHash: hashToken(token),
          expiresAt: expect.any(Date) as Date,
        },
      });
      const createCalls = prisma.passwordResetToken.create.mock.calls as [
        { data: { tokenHash: string } },
      ][];
      const persistedHash = createCalls[0][0].data.tokenHash;
      expect(persistedHash).not.toBe(token);
      expect(token).toEqual(expect.any(String));
    });
  });

  describe('consume', () => {
    it('throws InvalidResetTokenException when the token is unknown', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(service.consume('raw-token')).rejects.toThrow(
        InvalidResetTokenException,
      );
      expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
    });

    it('throws InvalidResetTokenException when the token is already used', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        ...activeRow,
        usedAt: new Date('2026-01-02T00:00:00Z'),
      });

      await expect(service.consume('raw-token')).rejects.toThrow(
        InvalidResetTokenException,
      );
      expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
    });

    it('throws InvalidResetTokenException when the token is expired', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        ...activeRow,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.consume('raw-token')).rejects.toThrow(
        InvalidResetTokenException,
      );
      expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
    });

    it('throws InvalidResetTokenException when updateMany affects 0 rows (lost the race to a concurrent consume)', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(activeRow);
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.consume('raw-token')).rejects.toThrow(
        InvalidResetTokenException,
      );
    });

    it('marks the token used and returns its userId when the token is valid', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(activeRow);
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.consume('raw-token');

      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { id: activeRow.id, usedAt: null },
        data: { usedAt: expect.any(Date) as Date },
      });
      expect(result).toEqual({ userId: activeRow.userId });
    });
  });
});
