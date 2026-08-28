// `service` and `existingUser` below are scaffolding for the it.todo cases —
// unused until those assertions are written in, not dead code.
/* eslint-disable @typescript-eslint/no-unused-vars */
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';

// Mocking setup only — see CLAUDE.md: assertions for code written in this
// same session are left for Boris to write (it.todo below names the
// behavior each test should verify).
describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock } };
  let passwordService: { hash: jest.Mock; compare: jest.Mock };
  let jwtService: { signAsync: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let refreshTokenService: { issue: jest.Mock };

  // A plain object matching Prisma's User shape — use as
  // prisma.user.findUnique.mockResolvedValue(existingUser) /
  // prisma.user.create.mockResolvedValue(existingUser).
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
      },
    };
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
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordService, useValue: passwordService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('signUp', () => {
    it.todo(
      'throws EmailAlreadyRegisteredException when the email is already taken, without calling user.create',
    );

    it.todo(
      'hashes the password, persists the user, and returns an AuthSession built from the new row',
    );
  });

  describe('signIn', () => {
    it.todo('throws InvalidCredentialsException for an unknown email');

    it.todo(
      'throws InvalidCredentialsException for a wrong password — same exception as an unknown email',
    );

    it.todo('returns an AuthSession for correct credentials');
  });
});
