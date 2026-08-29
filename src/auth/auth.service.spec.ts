import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { EmailAlreadyRegisteredException } from './exceptions/email-already-registered.exception';
import { InvalidCredentialsException } from './exceptions/invalid-credentials.exception';
import { InvalidRefreshTokenException } from './exceptions/invalid-refresh-token.exception';
import { InvalidResetTokenException } from './exceptions/invalid-reset-token.exception';
import { PasswordResetTokenService } from './password-reset-token.service';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let passwordService: { hash: jest.Mock; compare: jest.Mock };
  let jwtService: { signAsync: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let refreshTokenService: {
    issue: jest.Mock;
    rotate: jest.Mock;
    revoke: jest.Mock;
    revokeAllForUser: jest.Mock;
  };
  let passwordResetTokenService: { issue: jest.Mock; consume: jest.Mock };
  let mailService: {
    sendPasswordResetEmail: jest.Mock;
    sendPasswordChangedEmail: jest.Mock;
  };

  // A plain object matching Prisma's User shape.
  const existingUser = {
    id: 'user-1',
    email: 'jane@example.com',
    passwordHash: 'hashed-password',
    firstName: 'Jane',
    lastName: 'Doe',
    role: 'client',
    passwordChangedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      // Runs the callback with the same mock object as `tx`, so
      // tx.user.update === prisma.user.update and assertions on either
      // reference resolve to the same mock.
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    passwordService = {
      hash: jest.fn(),
      compare: jest.fn(),
    };
    jwtService = {
      signAsync: jest.fn(),
    };
    configService = {
      getOrThrow: jest.fn((key: string) =>
        key === 'JWT_ACCESS_EXPIRES_IN' ? '15m' : 'irrelevant-for-these-tests',
      ),
    };
    refreshTokenService = {
      issue: jest.fn(),
      rotate: jest.fn(),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn(),
    };
    passwordResetTokenService = {
      issue: jest.fn(),
      consume: jest.fn(),
    };
    mailService = {
      sendPasswordResetEmail: jest.fn(),
      sendPasswordChangedEmail: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordService, useValue: passwordService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        {
          provide: PasswordResetTokenService,
          useValue: passwordResetTokenService,
        },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  const signUpDto = {
    email: 'jane@example.com',
    password: 'super-secret',
    firstName: 'Jane',
    lastName: 'Doe',
  };

  const signInDto = { email: existingUser.email, password: 'super-secret' };

  function mockIssuedSession() {
    jwtService.signAsync.mockResolvedValue('access-token');
    refreshTokenService.issue.mockResolvedValue({
      token: 'refresh-token',
      expiresAt: new Date('2026-02-01T00:00:00Z'),
    });
  }

  describe('signUp', () => {
    it('throws EmailAlreadyRegisteredException when the email is already taken, without calling user.create', async () => {
      prisma.user.findUnique.mockResolvedValue(existingUser);

      await expect(service.signUp(signUpDto)).rejects.toThrow(
        EmailAlreadyRegisteredException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('hashes the password, persists the user, and returns an AuthSession built from the new row', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      passwordService.hash.mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue(existingUser);
      mockIssuedSession();

      const result = await service.signUp(signUpDto);

      expect(passwordService.hash).toHaveBeenCalledWith(signUpDto.password);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: signUpDto.email,
          passwordHash: 'hashed-password',
          firstName: signUpDto.firstName,
          lastName: signUpDto.lastName,
        },
      });
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: 900,
        user: {
          id: existingUser.id,
          email: existingUser.email,
          firstName: existingUser.firstName,
          lastName: existingUser.lastName,
          role: existingUser.role,
          passwordChangedAt: existingUser.passwordChangedAt,
          createdAt: existingUser.createdAt,
        },
      });
    });

    it('throws EmailAlreadyRegisteredException when user.create hits the unique constraint (lost a race to a concurrent sign-up)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      passwordService.hash.mockResolvedValue('hashed-password');
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.10.0',
          meta: {
            driverAdapterError: {
              cause: { constraint: { index: 'users_email_key' } },
            },
          },
        }),
      );

      await expect(service.signUp(signUpDto)).rejects.toBeInstanceOf(
        EmailAlreadyRegisteredException,
      );
    });
  });

  describe('signIn', () => {
    it('throws InvalidCredentialsException for an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.signIn(signInDto)).rejects.toThrow(
        InvalidCredentialsException,
      );
      expect(passwordService.compare).not.toHaveBeenCalled();
    });

    it('throws InvalidCredentialsException for a wrong password — same exception as an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(existingUser);
      passwordService.compare.mockResolvedValue(false);

      await expect(service.signIn(signInDto)).rejects.toThrow(
        InvalidCredentialsException,
      );

      let unknownEmailError: unknown;
      prisma.user.findUnique.mockResolvedValue(null);
      try {
        await service.signIn(signInDto);
      } catch (error) {
        unknownEmailError = error;
      }

      let wrongPasswordError: unknown;
      prisma.user.findUnique.mockResolvedValue(existingUser);
      passwordService.compare.mockResolvedValue(false);
      try {
        await service.signIn(signInDto);
      } catch (error) {
        wrongPasswordError = error;
      }

      expect(unknownEmailError).toBeInstanceOf(InvalidCredentialsException);
      expect(wrongPasswordError).toBeInstanceOf(InvalidCredentialsException);
      expect((unknownEmailError as Error).message).toBe(
        (wrongPasswordError as Error).message,
      );
    });

    it('returns an AuthSession for correct credentials', async () => {
      prisma.user.findUnique.mockResolvedValue(existingUser);
      passwordService.compare.mockResolvedValue(true);
      mockIssuedSession();

      const result = await service.signIn(signInDto);

      expect(passwordService.compare).toHaveBeenCalledWith(
        signInDto.password,
        existingUser.passwordHash,
      );
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.user.id).toBe(existingUser.id);
    });
  });

  describe('refreshTokens', () => {
    const dto = { refreshToken: 'raw-refresh-token' };

    it('propagates InvalidRefreshTokenException from refreshTokenService.rotate without catching it', async () => {
      refreshTokenService.rotate.mockRejectedValue(
        new InvalidRefreshTokenException(),
      );

      await expect(service.refreshTokens(dto)).rejects.toThrow(
        InvalidRefreshTokenException,
      );
      expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it("looks up the rotated token's userId and returns a new AuthSession for that user", async () => {
      refreshTokenService.rotate.mockResolvedValue({
        userId: existingUser.id,
      });
      prisma.user.findUniqueOrThrow.mockResolvedValue(existingUser);
      mockIssuedSession();

      const result = await service.refreshTokens(dto);

      expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: existingUser.id },
      });
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.user.id).toBe(existingUser.id);
    });
  });

  describe('signOut', () => {
    it('delegates to refreshTokenService.revoke and propagates InvalidRefreshTokenException', async () => {
      const dto = { refreshToken: 'raw-refresh-token' };
      refreshTokenService.revoke.mockRejectedValue(
        new InvalidRefreshTokenException(),
      );

      await expect(service.signOut(dto)).rejects.toThrow(
        InvalidRefreshTokenException,
      );
      expect(refreshTokenService.revoke).toHaveBeenCalledWith(dto.refreshToken);
    });
  });

  describe('forgotPassword', () => {
    const dto = { email: 'unknown@example.com' };

    it('resolves without sending an email or issuing a token when the email is unknown', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.forgotPassword(dto)).resolves.toBeUndefined();
      expect(passwordResetTokenService.issue).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('issues a reset token and sends the reset email when the account exists', async () => {
      prisma.user.findUnique.mockResolvedValue(existingUser);
      passwordResetTokenService.issue.mockResolvedValue('raw-reset-token');

      await service.forgotPassword({ email: existingUser.email });

      expect(passwordResetTokenService.issue).toHaveBeenCalledWith(
        existingUser.id,
      );
      expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        existingUser.email,
        existingUser.firstName,
        'raw-reset-token',
      );
    });
  });

  describe('resetPassword', () => {
    const dto = { token: 'raw-reset-token', password: 'new-super-secret' };

    it('propagates InvalidResetTokenException from passwordResetTokenService.consume without catching it', async () => {
      passwordResetTokenService.consume.mockRejectedValue(
        new InvalidResetTokenException(),
      );

      await expect(service.resetPassword(dto)).rejects.toThrow(
        InvalidResetTokenException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('hashes the new password, sets passwordChangedAt, and sends the password-changed notification email', async () => {
      passwordResetTokenService.consume.mockResolvedValue({
        userId: existingUser.id,
      });
      passwordService.hash.mockResolvedValue('new-hashed-password');
      const updatedUser = {
        ...existingUser,
        passwordHash: 'new-hashed-password',
        passwordChangedAt: new Date('2026-02-01T00:00:00Z'),
      };
      prisma.user.update.mockResolvedValue(updatedUser);

      await service.resetPassword(dto);

      expect(passwordService.hash).toHaveBeenCalledWith(dto.password);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: existingUser.id },
        data: {
          passwordHash: 'new-hashed-password',
          passwordChangedAt: expect.any(Date) as Date,
        },
      });
      expect(mailService.sendPasswordChangedEmail).toHaveBeenCalledWith(
        updatedUser.email,
        updatedUser.firstName,
      );
    });

    it('revokes every refresh token for the user in the same transaction as the password update (refreshTokenService.revokeAllForUser called with userId and the tx client)', async () => {
      passwordResetTokenService.consume.mockResolvedValue({
        userId: existingUser.id,
      });
      passwordService.hash.mockResolvedValue('new-hashed-password');
      prisma.user.update.mockResolvedValue(existingUser);

      await service.resetPassword(dto);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
        existingUser.id,
        prisma,
      );
      // The password write and the revoke must run inside the same
      // transaction callback, not as two independent top-level calls.
      const updateOrder = prisma.user.update.mock.invocationCallOrder[0];
      const revokeOrder =
        refreshTokenService.revokeAllForUser.mock.invocationCallOrder[0];
      expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
        Math.min(updateOrder, revokeOrder),
      );
    });
  });
});
