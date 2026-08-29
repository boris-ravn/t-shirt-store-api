import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { hashToken } from '../common/crypto/token.util';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvalidRefreshTokenException } from './exceptions/invalid-refresh-token.exception';
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

  // An active (non-revoked, non-expired) row.
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
    it('persists a hashed token (never the raw token) and returns the raw token plus its expiry', async () => {
      prisma.refreshToken.create.mockResolvedValue(activeRow);

      const result = await service.issue('user-1');

      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          tokenHash: hashToken(result.token),
          expiresAt: expect.any(Date) as Date,
        },
      });
      const createCalls = prisma.refreshToken.create.mock.calls as [
        { data: { tokenHash: string } },
      ][];
      const persistedHash = createCalls[0][0].data.tokenHash;
      expect(persistedHash).not.toBe(result.token);
      expect(result.token).toEqual(expect.any(String));
      expect(result.expiresAt).toEqual(expect.any(Date));
    });
  });

  describe('rotate', () => {
    it('throws InvalidRefreshTokenException when the token is unknown', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.rotate('raw-token')).rejects.toThrow(
        InvalidRefreshTokenException,
      );
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('throws InvalidRefreshTokenException when the token is already revoked', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...activeRow,
        revokedAt: new Date('2026-01-02T00:00:00Z'),
      });

      await expect(service.rotate('raw-token')).rejects.toThrow(
        InvalidRefreshTokenException,
      );
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('throws InvalidRefreshTokenException when the token is expired', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...activeRow,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.rotate('raw-token')).rejects.toThrow(
        InvalidRefreshTokenException,
      );
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('throws InvalidRefreshTokenException when updateMany affects 0 rows (lost the race to a concurrent rotate/revoke)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(activeRow);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.rotate('raw-token')).rejects.toThrow(
        InvalidRefreshTokenException,
      );
    });

    it('revokes the existing row and returns its userId when the token is valid', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(activeRow);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.rotate('raw-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: activeRow.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
      expect(result).toEqual({ userId: activeRow.userId });
    });
  });

  describe('revoke', () => {
    it('throws InvalidRefreshTokenException when the token is unknown', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.revoke('raw-token')).rejects.toThrow(
        InvalidRefreshTokenException,
      );
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('throws InvalidRefreshTokenException when the token is already revoked', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...activeRow,
        revokedAt: new Date('2026-01-02T00:00:00Z'),
      });

      await expect(service.revoke('raw-token')).rejects.toThrow(
        InvalidRefreshTokenException,
      );
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('does NOT check expiry — an expired-but-not-revoked token can still be revoked', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...activeRow,
        expiresAt: new Date(Date.now() - 1000),
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.revoke('raw-token')).resolves.toBeUndefined();
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: activeRow.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes every non-revoked row for the user (updateMany WHERE userId AND revokedAt IS NULL)', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      await service.revokeAllForUser('user-1');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
    });

    it('uses the passed-in transaction client instead of the injected PrismaService, when one is given', async () => {
      const tx = {
        refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      };

      await service.revokeAllForUser(
        'user-1',
        tx as unknown as Prisma.TransactionClient,
      );

      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });
});
